<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use App\Models\FetchBatch;
use App\Models\Property;
use App\Services\BillFetchService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;

class FetchBillJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 600;

    /**
     * Seconds between status polls against the Python API.
     */
    protected int $pollIntervalSeconds = 3;

    /**
     * Consecutive failed status requests tolerated before giving up.
     */
    protected int $maxConsecutivePollErrors = 10;

    public function __construct(
        public int $batchId,
        public array $referenceNumbers,
        public string $provider = 'iesco',
    ) {}

    public function handle(BillFetchService $fetchService): void
    {
        $batch = FetchBatch::findOrFail($this->batchId);
        $baseUrl = config('services.python_api.url');

        // Step 1: Start fetch on Python API
        $response = Http::connectTimeout(5)->timeout(30)->post("{$baseUrl}/{$this->provider}/fetch", [
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

        // Step 2: Poll Python API until complete, stopping well before the job timeout.
        $deadline = now()->addSeconds($this->timeout - 60);
        $consecutiveErrors = 0;

        while (true) {
            Sleep::for($this->pollIntervalSeconds)->seconds();

            if (now()->greaterThan($deadline)) {
                throw new \RuntimeException("Python task {$pythonTaskId} did not finish within {$this->timeout} seconds.");
            }

            try {
                $statusResponse = Http::connectTimeout(5)->timeout(15)->get("{$baseUrl}/{$this->provider}/status/{$pythonTaskId}");
            } catch (ConnectionException $e) {
                $statusResponse = null;
            }

            if ($statusResponse === null || ! $statusResponse->successful()) {
                if (++$consecutiveErrors >= $this->maxConsecutivePollErrors) {
                    throw new \RuntimeException('Python API stopped responding while polling task status.');
                }

                continue;
            }

            $consecutiveErrors = 0;
            $status = $statusResponse->json('status');

            if ($status === 'not_found') {
                throw new \RuntimeException("Python task {$pythonTaskId} was lost (was the Python API restarted?).");
            }

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
        $resultsResponse = Http::connectTimeout(5)->timeout(30)->get("{$baseUrl}/{$this->provider}/results/{$pythonTaskId}");
        if (! $resultsResponse->successful()) {
            throw new \RuntimeException('Could not download fetch results: HTTP '.$resultsResponse->status());
        }

        $results = $resultsResponse->json();

        if (! is_array($results)) {
            throw new \RuntimeException('Python API returned malformed fetch results.');
        }

        if (isset($results['error']) && is_string($results['error'])) {
            throw new \RuntimeException("Python API returned no results: {$results['error']}");
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

            if ($fetchStatus === 'SUCCESS') {
                $bill = $fetchService->storeFetchedBill($property, $billData, $this->provider);

                if ($bill->wasRecentlyCreated) {
                    $succeededRefs[] = ['ref' => $refNo, 'month' => $bill->bill_month];
                } else {
                    Log::info("FetchBatch {$this->batchId}: Skipping {$refNo} for {$bill->bill_month} — already exists");
                    $succeededRefs[] = ['ref' => $refNo, 'note' => 'already exists'];
                }
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
                'status' => 'failed',
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
