<?php

namespace App\Http\Controllers;

use App\Models\Property;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ComparativeController extends Controller
{
    private function parseBillMonth(string $billMonth): ?Carbon
    {
        try {
            return Carbon::createFromFormat('M y', $billMonth);
        } catch (\Throwable) {
            try {
                return Carbon::createFromFormat('M Y', $billMonth);
            } catch (\Throwable) {
                return null;
            }
        }
    }

    public function analyze(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'reference_numbers' => 'required|array|min:1',
            'reference_numbers.*' => 'string',
        ]);

        $referenceNumbers = $validated['reference_numbers'];

        $properties = Property::whereIn('reference_no', $referenceNumbers)
            ->with(['bills' => function ($q) {
                $q->orderByDesc('bill_month');
            }])
            ->get()
            ->keyBy('reference_no');

        $results = [];

        foreach ($referenceNumbers as $refNo) {
            $property = $properties->get($refNo);
            if (! $property) {
                $results[] = [
                    'reference_no' => $refNo,
                    'property_name' => null,
                    'error' => 'Property not found',
                ];

                continue;
            }

            $billsByMonth = $property->bills->keyBy('bill_month');

            // Use latest bill as current month
            $currentBill = $property->bills->first();
            if (! $currentBill) {
                $results[] = [
                    'reference_no' => $refNo,
                    'property_name' => $property->name,
                    'error' => 'No bills found',
                ];

                continue;
            }

            $currentMonthStr = strtoupper($currentBill->bill_month);
            $currentDate = $this->parseBillMonth($currentMonthStr);

            // Derive prev month and last year from current bill's month
            if ($currentDate) {
                $prevMonthStr = strtoupper($currentDate->copy()->subMonth()->format('M y'));
                $lastYearStr = strtoupper($currentDate->copy()->subYear()->format('M y'));
            } else {
                $prevMonthStr = '';
                $lastYearStr = '';
            }

            // Current month: units from raw_data, amount from website_payable
            $currentUnits = $currentBill->raw_data['ENERGY_DETAILS_UNITS'] ?? null;
            $currentAmount = $currentBill->website_payable;

            // Prior month: prefer saved bill, fallback to current bill's history fields
            $prevBill = $billsByMonth->get($prevMonthStr);
            if ($prevBill) {
                $prevUnits = $prevBill->raw_data['ENERGY_DETAILS_UNITS'] ?? null;
                $prevAmount = $prevBill->website_payable;
            } else {
                $prevUnits = $currentBill->history_last_kwh_units ?: null;
                $prevAmount = $currentBill->history_last_bill_rs ?: null;
            }

            // Last year: prefer saved bill, fallback to current bill's history fields
            $lastYearBill = $billsByMonth->get($lastYearStr);
            if ($lastYearBill) {
                $lastYearUnits = $lastYearBill->raw_data['ENERGY_DETAILS_UNITS'] ?? null;
                $lastYearAmount = $lastYearBill->website_payable;
            } else {
                $lastYearUnits = $currentBill->history_first_kwh_units ?: null;
                $lastYearAmount = $currentBill->history_first_bill_rs ?: null;
            }

            $results[] = [
                'reference_no' => $refNo,
                'property_name' => $property->name,
                'location' => $property->location->code ?? null,
                'property_type' => $property->property_type,
                'meter_no' => $property->meter_no,
                'comparative' => [
                    'current_month' => $currentMonthStr,
                    'prev_month' => $prevMonthStr,
                    'last_year_same_month' => $lastYearStr,
                    'units' => [
                        'current' => $currentUnits,
                        'prev' => $prevUnits,
                        'last_year' => $lastYearUnits,
                    ],
                    'amount' => [
                        'current' => $currentAmount,
                        'prev' => $prevAmount,
                        'last_year' => $lastYearAmount,
                    ],
                ],
            ];
        }

        return response()->json($results);
    }
}
