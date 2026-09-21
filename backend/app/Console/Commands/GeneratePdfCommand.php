<?php

namespace App\Console\Commands;

use App\Jobs\GenerateBillPdfJob;
use App\Models\ActivityLog;
use App\Models\Bill;
use Illuminate\Console\Command;

class GeneratePdfCommand extends Command
{
    protected $signature = 'bills:generate-pdf';

    protected $description = 'Generate PDFs for all bills without PDFs';

    public function handle(): int
    {
        $billIds = Bill::whereNull('pdf_generated_at')
            ->whereNotNull('raw_html_path')
            ->pluck('id');

        if ($billIds->isEmpty()) {
            $this->info('No pending PDFs to generate.');
            ActivityLog::create([
                'type' => 'pdf',
                'status' => 'success',
                'message' => 'No pending PDFs to generate during auto-PDF',
            ]);

            return self::SUCCESS;
        }

        $count = $billIds->count();

        foreach ($billIds as $billId) {
            GenerateBillPdfJob::dispatch($billId);
        }

        $this->info("Queued {$count} PDFs for generation.");

        ActivityLog::create([
            'type' => 'pdf',
            'status' => 'success',
            'message' => "Auto-PDF queued {$count} bills for generation",
            'details' => ['count' => $count, 'bill_ids' => $billIds->toArray()],
        ]);

        return self::SUCCESS;
    }
}
