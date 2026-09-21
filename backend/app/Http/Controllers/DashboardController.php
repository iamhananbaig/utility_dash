<?php

namespace App\Http\Controllers;

use App\Models\Bill;
use App\Models\Location;
use App\Models\Property;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;

class DashboardController extends Controller
{
    public function index(): JsonResponse
    {
        $now = Carbon::now();
        $activeMeters = Property::where('status', 'active')->count();
        $totalBills = Bill::count();
        $totalLocations = Location::count();

        // Bill status counts and amounts (3 statuses only)
        $unpaidBills = Bill::where('status', 'unpaid')->count();
        $unpaidAmount = Bill::where('status', 'unpaid')->sum('website_payable');
        $unpaidEarliest = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->orderBy('due_date')
            ->value('due_date');

        $inProcessBills = Bill::where('status', 'in_process')->count();
        $inProcessAmount = Bill::where('status', 'in_process')->sum('website_payable');
        $inProcessEarliest = Bill::where('status', 'in_process')
            ->whereNotNull('due_date')
            ->orderBy('due_date')
            ->value('due_date');

        $paidBills = Bill::where('status', 'paid')->count();
        $paidAmount = Bill::where('status', 'paid')->sum('paid_amount');

        // Urgency: unpaid bills due today or overdue (surcharge risk)
        $urgentBills = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->where('due_date', '<=', $now->toDateString())
            ->count();
        $urgentAmount = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->where('due_date', '<=', $now->toDateString())
            ->sum('website_payable');

        // Upcoming: unpaid bills due in next 7 days
        $upcomingBills = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->where('due_date', '>', $now->toDateString())
            ->where('due_date', '<=', $now->copy()->addDays(7)->toDateString())
            ->count();
        $upcomingAmount = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->where('due_date', '>', $now->toDateString())
            ->where('due_date', '<=', $now->copy()->addDays(7)->toDateString())
            ->sum('website_payable');
        $upcomingSurcharge = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->where('due_date', '>', $now->toDateString())
            ->where('due_date', '<=', $now->copy()->addDays(7)->toDateString())
            ->sum('surcharge');

        // Due aging for unpaid bills only
        $dueAging = [
            'due_today' => 0,
            'due_tomorrow' => 0,
            'due_later' => 0,
        ];
        $dueAgingAmounts = [
            'due_today' => 0,
            'due_tomorrow' => 0,
            'due_later' => 0,
        ];
        $dueLaterEarliest = null;

        $unpaidBillsList = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->get();

        foreach ($unpaidBillsList as $bill) {
            try {
                $dueDate = Carbon::parse($bill->due_date);
                $daysUntilDue = $now->diffInDays($dueDate, false);

                if ($daysUntilDue <= 0) {
                    $key = 'due_today';
                } elseif ($daysUntilDue === 1) {
                    $key = 'due_tomorrow';
                } else {
                    $key = 'due_later';
                    if ($dueLaterEarliest === null || $dueDate->lt($dueLaterEarliest)) {
                        $dueLaterEarliest = $dueDate;
                    }
                }

                $dueAging[$key]++;
                $dueAgingAmounts[$key] += $bill->website_payable;
            } catch (\Throwable) {
                // skip
            }
        }

        // Recent bills
        $recentBills = Bill::with('property.location')
            ->orderByDesc('created_at')
            ->limit(10)
            ->get();

        return response()->json([
            'stats' => [
                'active_meters' => $activeMeters,
                'total_locations' => $totalLocations,
                'total_bills' => $totalBills,
                'unpaid_bills' => $unpaidBills,
                'unpaid_amount' => round($unpaidAmount, 2),
                'unpaid_earliest' => $unpaidEarliest,
                'in_process_bills' => $inProcessBills,
                'in_process_amount' => round($inProcessAmount, 2),
                'in_process_earliest' => $inProcessEarliest,
                'paid_bills' => $paidBills,
                'paid_amount' => round($paidAmount, 2),
                'urgent_bills' => $urgentBills,
                'urgent_amount' => round($urgentAmount, 2),
                'upcoming_bills' => $upcomingBills,
                'upcoming_amount' => round($upcomingAmount, 2),
                'upcoming_surcharge' => round($upcomingSurcharge, 2),
                'due_aging' => $dueAging,
                'due_aging_amounts' => $dueAgingAmounts,
                'due_later_earliest' => $dueLaterEarliest?->format('Y-m-d'),
            ],
            'recent_bills' => $recentBills,
        ]);
    }
}
