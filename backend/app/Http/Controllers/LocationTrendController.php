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
        $monthlyAmountTotals = array_fill_keys($months, 0);
        $monthlyUnitsTotals = array_fill_keys($months, 0);

        foreach ($properties as $property) {
            $billsByMonth = $property->bills->keyBy('bill_month');

            $monthlyData = [];

            foreach ($months as $month) {
                $bill = $billsByMonth->get($month);

                if ($bill) {
                    $units = isset($bill->raw_data['ENERGY_DETAILS_UNITS'])
                        ? (float) $bill->raw_data['ENERGY_DETAILS_UNITS']
                        : null;
                    $amount = (float) $bill->website_payable;

                    $monthlyData[$month] = [
                        'amount' => $amount,
                        'units' => $units,
                    ];
                    $monthlyAmountTotals[$month] += $amount;
                    if ($units !== null) {
                        $monthlyUnitsTotals[$month] += $units;
                    }
                } else {
                    $monthlyData[$month] = null;
                }
            }

            $propertyData[] = [
                'reference_no' => $property->reference_no,
                'name' => $property->name,
                'property_type' => $property->property_type,
                'monthly_data' => $monthlyData,
            ];
        }

        return response()->json([
            'location' => [
                'id' => $location->id,
                'code' => $location->code,
            ],
            'year' => $year,
            'months' => $months,
            'totals' => array_values($monthlyAmountTotals),
            'units_totals' => array_values($monthlyUnitsTotals),
            'properties' => $propertyData,
        ]);
    }
}
