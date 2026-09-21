<?php

namespace App\Console\Commands;

use App\Models\ActivityLog;
use App\Models\Property;
use App\Services\BillFetchService;
use Illuminate\Console\Command;

class FetchBillsCommand extends Command
{
    protected $signature = 'bills:fetch';

    protected $description = 'Fetch bills for all providers with active properties';

    public function handle(BillFetchService $fetchService): int
    {
        $providers = Property::where('status', 'active')
            ->distinct()
            ->pluck('provider');

        if ($providers->isEmpty()) {
            $this->info('No active properties found.');
            ActivityLog::create([
                'type' => 'fetch',
                'status' => 'failed',
                'message' => 'No active properties found for auto-fetch',
            ]);

            return self::FAILURE;
        }

        $batchIds = [];

        foreach ($providers as $provider) {
            try {
                $batch = $fetchService->startBatch(null, null, $provider);
                $batchIds[] = $batch->id;
                $this->info("Started fetch for {$provider}: batch {$batch->id} ({$batch->total_refs} refs)");
            } catch (\Throwable $e) {
                $this->error("Failed to start fetch for {$provider}: {$e->getMessage()}");
                ActivityLog::create([
                    'type' => 'fetch',
                    'status' => 'failed',
                    'message' => "Failed to start fetch for {$provider}: {$e->getMessage()}",
                    'details' => ['provider' => $provider, 'error' => $e->getMessage()],
                ]);
            }
        }

        ActivityLog::create([
            'type' => 'fetch',
            'status' => 'success',
            'message' => "Auto-fetch started for {$providers->count()} provider(s): ".implode(', ', $providers->toArray()),
            'details' => ['providers' => $providers->toArray(), 'batch_ids' => $batchIds],
        ]);

        return self::SUCCESS;
    }
}
