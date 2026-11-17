<?php

namespace App\Services;

use App\Jobs\FetchBillJob;
use App\Models\Bill;
use App\Models\FetchBatch;
use App\Models\Property;
use Illuminate\Support\Facades\Storage;

class BillFetchService
{
    public function startBatch(?int $locationId = null, ?string $propertyType = null, ?string $provider = null): FetchBatch
    {
        $query = Property::forFetch($provider);

        if ($locationId !== null) {
            $query->where('location_id', $locationId);
        }

        if ($propertyType !== null) {
            $query->where('property_type', $propertyType);
        }

        $properties = $query->get();
        $referenceNumbers = $properties->pluck('reference_no')->values()->all();

        $batch = FetchBatch::create([
            'total_refs' => count($referenceNumbers),
            'status' => 'running',
            'started_at' => now(),
        ]);

        FetchBillJob::dispatch($batch->id, $referenceNumbers, $provider ?? 'iesco');

        return $batch;
    }

    public function startSingle(string $referenceNo, string $provider = 'iesco'): FetchBatch
    {
        $batch = FetchBatch::create([
            'total_refs' => 1,
            'status' => 'running',
            'started_at' => now(),
        ]);

        FetchBillJob::dispatch($batch->id, [$referenceNo], $provider);

        return $batch;
    }

    /**
     * Persist a successfully fetched bill row from the Python API.
     *
     * Returns the existing bill (wasRecentlyCreated = false) when one is already
     * stored for the same property and month.
     *
     * @param  array<string, mixed>  $billData
     */
    public function storeFetchedBill(Property $property, array $billData, string $provider): Bill
    {
        $rawHtml = $billData['_RAW_HTML'] ?? '';
        unset($billData['_RAW_HTML']);

        $billMonth = $billData['BILL_MONTH'] ?? null;

        $existing = Bill::where('property_id', $property->id)
            ->where('bill_month', $billMonth)
            ->first();

        if ($existing) {
            return $existing;
        }

        $rawHtmlPath = null;
        if ($rawHtml !== '') {
            $rawHtmlPath = 'bills/'.$provider.'/'.$property->id.'/'.($billMonth ?? now()->format('M_Y')).'.html';
            Storage::disk('local')->put($rawHtmlPath, $rawHtml);
        }

        return Bill::create([
            'property_id' => $property->id,
            'provider' => $provider,
            'bill_month' => $billMonth,
            'issue_date' => $billData['ISSUE_DATE'] ?? null,
            'reading_date' => $billData['READING_DATE'] ?? null,
            'due_date' => $billData['DUE_DATE'] ?? null,
            'arrears_amount' => $billData['ARREARS_AMOUNT'] ?? 0,
            'arrears_raw' => $billData['ARREARS_RAW'] ?? null,
            'energy_charges' => $billData['ENERGY_DETAILS_TOTAL'] ?? 0,
            'taxes_total' => $billData['TAXES_TOTAL'] ?? 0,
            'fpa_taxes_total' => $billData['TAXES_ON_FPA_TOTAL'] ?? 0,
            'advance_tax' => ($billData['TAXES_ITAX'] ?? 0) + ($billData['FPA_DETAILS_IT'] ?? 0),
            'surcharge' => $billData['SURCHARGE_AMOUNT'] ?? 0,
            'payable_after_due_date' => $billData['PAYABLE_AFTER_DUE_DATE'] ?? 0,
            'calculated_payable' => $billData['CALCULATED_PAYABLE_WITHIN_DUE_DATE'] ?? 0,
            'website_payable' => $billData['WEBSITE_PAYABLE_WITHIN_DUE_DATE'] ?? 0,
            'payable_difference' => $billData['PAYABLE_DIFFERENCE'] ?? 0,
            'comparison_status' => $billData['PAYABLE_COMPARISON'] ?? null,
            'returned_reference_no' => $billData['RETURNED_REFERENCE_NO'] ?? null,
            'reference_verification' => $billData['REFERENCE_VERIFICATION'] ?? null,
            'website_payable_source' => $billData['WEBSITE_PAYABLE_SOURCE'] ?? null,
            'history_first_month' => $billData['HISTORY_FIRST_MONTH'] ?? null,
            'history_first_kwh_units' => $billData['HISTORY_FIRST_KWH_UNITS'] ?? 0,
            'history_first_bill_rs' => $billData['HISTORY_FIRST_BILL_RS'] ?? 0,
            'history_last_month' => $billData['HISTORY_LAST_MONTH'] ?? null,
            'history_last_kwh_units' => $billData['HISTORY_LAST_KWH_UNITS'] ?? 0,
            'history_last_bill_rs' => $billData['HISTORY_LAST_BILL_RS'] ?? 0,
            'history_status' => $billData['HISTORY_STATUS'] ?? null,
            'raw_data' => $billData,
            'raw_html_path' => $rawHtmlPath,
            'fetched_at' => $billData['FETCHED_AT'] ?? now(),
        ]);
    }
}
