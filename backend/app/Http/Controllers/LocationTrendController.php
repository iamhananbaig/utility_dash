<?php

namespace App\Http\Controllers;

use App\Models\Location;
use App\Models\Property;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LocationTrendController extends Controller
{
    public function trend(Request $request, int $locationId): JsonResponse
    {
        $year = (int) $request->input('year', now()->year);
        $location = Location::findOrFail($locationId);

        $properties = Property::where('location_id', $locationId)
            ->with(['bills' => function ($q) use ($year) {
                $q->whereYear('fetched_at', $year)
                    ->orWhere('bill_month', 'like', '% '.substr($year, -2));
            }])
            ->orderBy('reference_no')
            ->get();

        // Generate all 12 months for the year
        $months = [];
        for ($m = 1; $m <= 12; $m++) {
            $date = Carbon::createFromDate($year, $m, 1);
            $months[] = strtoupper($date->format('M y'));
        }

        $propertyData = [];
        $monthlyTotals = array_fill_keys($months, 0);

        foreach ($properties as $property) {
            $billsByMonth = $property->bills->keyBy('bill_month');

            // Sort saved bills by month descending (newest first)
            $sortedBills = $property->bills->sortByDesc(function ($bill) {
                try {
                    return Carbon::createFromFormat('M y', strtolower($bill->bill_month))->timestamp;
                } catch (\Throwable) {
                    return 0;
                }
            });

            $monthlyAmounts = [];

            foreach ($months as $month) {
                $bill = $billsByMonth->get($month);

                if ($bill) {
                    // Saved bill exists - use website_payable
                    $monthlyAmounts[$month] = [
                        'amount' => (float) $bill->website_payable,
                        'estimated' => false,
                    ];
                    $monthlyTotals[$month] += (float) $bill->website_payable;
                } else {
                    // No saved bill for this month
                    // Find the NEXT available bill (closest future month) and use its history_last_bill_rs
                    $estimated = $this->getEstimatedAmount($month, $sortedBills);

                    if ($estimated !== null) {
                        $monthlyAmounts[$month] = ['amount' => $estimated, 'estimated' => true];
                        $monthlyTotals[$month] += $estimated;
                    } else {
                        $monthlyAmounts[$month] = null;
                    }
                }
            }

            $propertyData[] = [
                'reference_no' => $property->reference_no,
                'name' => $property->name,
                'property_type' => $property->property_type,
                'monthly_amounts' => $monthlyAmounts,
            ];
        }

        return response()->json([
            'location' => [
                'id' => $location->id,
                'code' => $location->code,
            ],
            'year' => $year,
            'months' => $months,
            'totals' => array_values($monthlyTotals),
            'properties' => $propertyData,
        ]);
    }

    private function getEstimatedAmount(string $month, $sortedBills): ?float
    {
        try {
            $targetDate = Carbon::createFromFormat('M y', strtolower($month));
        } catch (\Throwable) {
            return null;
        }

        // Find the first saved bill that is AFTER this month
        // That bill's history_last_bill_rs = amount for the month before it
        // We need to walk forward through bills until we find one that covers this month
        foreach ($sortedBills as $bill) {
            try {
                $billDate = Carbon::createFromFormat('M y', strtolower($bill->bill_month));
            } catch (\Throwable) {
                continue;
            }

            if ($billDate->gt($targetDate)) {
                // This bill is after the target month
                $monthsAfter = (int) $billDate->diffInMonths($targetDate);

                if (abs($monthsAfter) === 1) {
                    // This bill is exactly 1 month after - its history_last is this month's amount
                    if ($bill->history_last_bill_rs > 0) {
                        return (float) $bill->history_last_bill_rs;
                    }
                }
            }
        }

        return null;
    }
}
