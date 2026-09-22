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
        $today = $now->toDateString();
        $tomorrow = $now->copy()->addDay()->toDateString();
        $weekLater = $now->copy()->addDays(7)->toDateString();

        $activeMeters = Property::where('status', 'active')->count();
        $totalBills = Bill::count();
        $totalLocations = Location::count();

        // Single grouped query for status counts and amounts
        $statusStats = Bill::select('status')
            ->selectRaw('COUNT(*) as count')
            ->selectRaw('SUM(website_payable) as total_payable')
            ->selectRaw('SUM(paid_amount) as total_paid')
            ->groupBy('status')
            ->get()
            ->keyBy('status');

        $unpaidBills = $statusStats['unpaid']->count ?? 0;
        $unpaidAmount = (float) ($statusStats['unpaid']->total_payable ?? 0);
        $inProcessBills = $statusStats['in_process']->count ?? 0;
        $inProcessAmount = (float) ($statusStats['in_process']->total_payable ?? 0);
        $paidBills = $statusStats['paid']->count ?? 0;
        $paidAmount = (float) ($statusStats['paid']->total_paid ?? 0);

        // Earliest due dates per status
        $earliestDue = Bill::whereIn('status', ['unpaid', 'in_process'])
            ->whereNotNull('due_date')
            ->select('status')
            ->selectRaw('MIN(due_date) as earliest')
            ->groupBy('status')
            ->get()
            ->keyBy('status');

        $unpaidEarliest = $earliestDue['unpaid']->earliest ?? null;
        $inProcessEarliest = $earliestDue['in_process']->earliest ?? null;

        // Urgent: unpaid due today or overdue
        $urgentBills = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->where('due_date', '<=', $today)
            ->selectRaw('COUNT(*) as count, SUM(website_payable) as amount')
            ->first();

        // Upcoming: unpaid due in next 7 days
        $upcomingBills = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->where('due_date', '>', $today)
            ->where('due_date', '<=', $weekLater)
            ->selectRaw('COUNT(*) as count, SUM(website_payable) as amount, SUM(surcharge) as surcharge')
            ->first();

        // Due aging using conditional queries
        $dueAging = [
            'due_today' => Bill::where('status', 'unpaid')->whereNotNull('due_date')->where('due_date', '<=', $today)->count(),
            'due_tomorrow' => Bill::where('status', 'unpaid')->where('due_date', $tomorrow)->count(),
            'due_later' => Bill::where('status', 'unpaid')->whereNotNull('due_date')->where('due_date', '>', $tomorrow)->count(),
        ];

        $dueAgingAmounts = [
            'due_today' => (float) Bill::where('status', 'unpaid')->whereNotNull('due_date')->where('due_date', '<=', $today)->sum('website_payable'),
            'due_tomorrow' => (float) Bill::where('status', 'unpaid')->where('due_date', $tomorrow)->sum('website_payable'),
            'due_later' => (float) Bill::where('status', 'unpaid')->whereNotNull('due_date')->where('due_date', '>', $tomorrow)->sum('website_payable'),
        ];

        $dueLaterEarliest = Bill::where('status', 'unpaid')
            ->whereNotNull('due_date')
            ->where('due_date', '>', $tomorrow)
            ->value('due_date');

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
                'urgent_bills' => $urgentBills->count ?? 0,
                'urgent_amount' => round((float) ($urgentBills->amount ?? 0), 2),
                'upcoming_bills' => $upcomingBills->count ?? 0,
                'upcoming_amount' => round((float) ($upcomingBills->amount ?? 0), 2),
                'upcoming_surcharge' => round((float) ($upcomingBills->surcharge ?? 0), 2),
                'due_aging' => $dueAging,
                'due_aging_amounts' => $dueAgingAmounts,
                'due_later_earliest' => $dueLaterEarliest,
            ],
            'recent_bills' => $recentBills,
        ]);
    }
}
