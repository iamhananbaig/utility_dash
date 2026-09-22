<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use App\Models\Bill;
use App\Models\FetchBatch;
use App\Models\Property;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class FetchBillJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct(
        public int $batchId,
        public array $referenceNumbers,
        public string $provider = 'iesco',
    ) {}

    public function handle(): void
    {
        $batch = FetchBatch::findOrFail($this->batchId);
        $baseUrl = config('services.python_api.url');

        // Step 1: Start fetch on Python API
        $response = Http::timeout(30)->post("{$baseUrl}/{$this->provider}/fetch", [
            'reference_numbers' => $this->referenceNumbers,
        ]);

        if (! $response->successful()) {
            throw new \RuntimeException('Python API fetch failed: '.$response->body());
        }

        $pythonTaskId = $response->json('task_id');
        $total = $response->json('total');

        if ($pythonTaskId === '' || $total === 0) {
            $batch->update([
                'status' => 'completed',
                'completed_at' => now(),
            ]);

            return;
        }

        Log::info("FetchBatch {$this->batchId}: Python task {$pythonTaskId} started for {$total} refs");

        // Step 2: Poll Python API until complete
        while (true) {
            sleep(3);

            $statusResponse = Http::timeout(15)->get("{$baseUrl}/iesco/status/{$pythonTaskId}");
            if (! $statusResponse->successful()) {
                continue;
            }

            $status = $statusResponse->json('status');
            $completed = $statusResponse->json('completed', 0);
            $successCount = $statusResponse->json('success_count', 0);
            $failCount = $statusResponse->json('fail_count', 0);

            $batch->update([
                'completed' => $completed,
                'success_count' => $successCount,
                'fail_count' => $failCount,
            ]);

            Log::info("FetchBatch {$this->batchId}: {$completed}/{$total} ({$successCount} ok, {$failCount} fail)");

            if ($status === 'completed') {
                break;
            }
        }

        // Step 3: Get results
        $resultsResponse = Http::timeout(30)->get("{$baseUrl}/iesco/results/{$pythonTaskId}");
        if (! $resultsResponse->successful()) {
            $batch->update(['status' => 'completed', 'completed_at' => now()]);

            return;
        }

        $results = $resultsResponse->json();

        if (! is_array($results)) {
            $batch->update(['status' => 'completed', 'completed_at' => now()]);

            return;
        }

        // Step 4: Save bills to database
        $propertyMap = Property::whereIn('reference_no', $this->referenceNumbers)
            ->get()
            ->keyBy('reference_no');

        $failedRefs = [];
        $succeededRefs = [];

        foreach ($results as $refNo => $billData) {
            $property = $propertyMap->get($refNo);
            if (! $property) {
                $failedRefs[] = ['ref' => $refNo, 'reason' => 'property not found'];

                continue;
            }

            $fetchStatus = $billData['FETCH_STATUS'] ?? 'FAILED';
            $rawHtml = $billData['_RAW_HTML'] ?? '';
            unset($billData['_RAW_HTML']);

            // Store raw HTML
            $rawHtmlPath = null;
            if ($rawHtml !== '') {
                $directory = 'bills/iesco/'.$property->id;
                $fileName = ($billData['BILL_MONTH'] ?? now()->format('M_Y')).'.html';
                Storage::disk('local')->put($directory.'/'.$fileName, $rawHtml);
                $rawHtmlPath = $directory.'/'.$fileName;
            }

            if ($fetchStatus === 'SUCCESS') {
                $billMonth = $billData['BILL_MONTH'] ?? null;

                // Skip if bill already exists for this property+month
                $existing = Bill::where('property_id', $property->id)
                    ->where('bill_month', $billMonth)
                    ->first();

                if ($existing) {
                    Log::info("FetchBatch {$this->batchId}: Skipping {$refNo} for {$billMonth} — already exists");
                    $succeededRefs[] = ['ref' => $refNo, 'note' => 'already exists'];

                    continue;
                }

                Bill::create([
                    'property_id' => $property->id,
                    'provider' => $this->provider,
                    'bill_month' => $billData['BILL_MONTH'] ?? null,
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

                $succeededRefs[] = ['ref' => $refNo, 'month' => $billMonth];
            } else {
                $reason = $billData['FETCH_ERROR'] ?? $billData['ERROR'] ?? $fetchStatus;
                $failedRefs[] = ['ref' => $refNo, 'reason' => $reason];
            }
        }

        $batch->update([
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        Log::info("FetchBatch {$this->batchId}: completed. {$batch->success_count} saved, {$batch->fail_count} failed.");

        ActivityLog::create([
            'type' => 'fetch',
            'status' => $batch->fail_count > 0 ? 'failed' : 'success',
            'batch_id' => $batch->id,
            'message' => "Fetch completed: {$batch->success_count} success, {$batch->fail_count} failed out of {$batch->total_refs} total",
            'details' => [
                'provider' => $this->provider,
                'total' => $batch->total_refs,
                'success' => $batch->success_count,
                'fail' => $batch->fail_count,
                'succeeded_refs' => $succeededRefs,
                'failed_refs' => $failedRefs,
            ],
        ]);
    }

    public function failed(\Throwable $exception): void
    {
        Log::error("FetchBatch {$this->batchId} failed: {$exception->getMessage()}", [
            'batch_id' => $this->batchId,
            'exception' => $exception,
        ]);

        $batch = FetchBatch::find($this->batchId);
        if ($batch) {
            $batch->update([
                'status' => 'completed',
                'completed_at' => now(),
                'error_log' => ['error' => $exception->getMessage()],
            ]);
        }

        ActivityLog::create([
            'type' => 'fetch',
            'status' => 'failed',
            'batch_id' => $this->batchId,
            'message' => "Fetch job failed: {$exception->getMessage()}",
            'details' => ['provider' => $this->provider, 'error' => $exception->getMessage()],
        ]);
    }
}
