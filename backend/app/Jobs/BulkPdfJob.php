<?php

namespace App\Jobs;

use App\Helpers\PdfHelper;
use App\Models\Bill;
use App\Models\PdfBatch;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class BulkPdfJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct(
        public int $batchId,
        public array $billIds,
    ) {
        $this->queue = 'pdf';
    }

    public function handle(): void
    {
        $batch = PdfBatch::findOrFail($this->batchId);
        $batch->update(['status' => 'processing']);

        $bills = Bill::with('property.location')->whereIn('id', $this->billIds)->get();

        if ($bills->isEmpty()) {
            $batch->update(['status' => 'failed', 'error' => 'No bills found']);

            return;
        }

        $baseTag = '<base href="https://bill.pitc.com.pk/iescobill/" />';
        $htmlParts = [];
        $idx = 0;

        foreach ($bills as $bill) {
            if ($bill->raw_html_path === null) {
                continue;
            }

            $content = Storage::disk('local')->get($bill->raw_html_path);
            $content = preg_replace('/<noscript>.*?<\/noscript>/is', '', $content);

            $prefix = 'b'.$idx.'_';
            $content = str_replace('<head>', '<head>'.$baseTag, $content);
            $content = preg_replace('/id="([^"]+)"/', 'id="'.$prefix.'$1"', $content);
            $content = preg_replace("/id='([^']+)'/", "id='${prefix}$1'", $content);
            $content = preg_replace('/for="([^"]+)"/', 'for="'.$prefix.'$1"', $content);
            $content = preg_replace('/getElementById\("([^"]+)"\)/', 'getElementById("'.$prefix.'$1")', $content);
            $content = preg_replace("/getElementById\('([^']+)'\)/", "getElementById('${prefix}$1')", $content);

            $qrInit = PdfHelper::qrInitScript($prefix);

            $htmlParts[] = '<div class="bill-page">'.$content.$qrInit.'</div>';
            $idx++;
        }

        if (empty($htmlParts)) {
            $batch->update(['status' => 'failed', 'error' => 'No bills with HTML content found']);

            return;
        }

        $html = PdfHelper::wrapBulkBills($htmlParts, $baseTag);

        $tempDir = sys_get_temp_dir();
        $tempHtml = $tempDir.'/bills_bulk_'.$this->batchId.'_'.time().'.html';
        $tempPdf = $tempDir.'/bills_bulk_'.$this->batchId.'_'.time().'.pdf';
        file_put_contents($tempHtml, $html);

        $scriptPath = base_path().'/../pdf-service/pdf-generator.js';
        $cmd = 'node '.escapeshellarg($scriptPath).' --file '.escapeshellarg($tempHtml).' --output '.escapeshellarg($tempPdf).' 2>&1';
        exec($cmd, $output, $returnCode);

        @unlink($tempHtml);

        if ($returnCode !== 0 || ! file_exists($tempPdf)) {
            @unlink($tempPdf);
            $batch->update([
                'status' => 'failed',
                'error' => 'PDF generation failed: '.implode("\n", $output),
            ]);

            return;
        }

        $pdfPath = 'bills/bulk/batch_'.$this->batchId.'.pdf';
        Storage::disk('local')->put($pdfPath, file_get_contents($tempPdf));
        @unlink($tempPdf);

        $batch->update([
            'status' => 'completed',
            'pdf_path' => $pdfPath,
        ]);

        Log::info("BulkPdfJob: batch {$this->batchId} completed. PDF at {$pdfPath}");
    }

    public function failed(\Throwable $exception): void
    {
        Log::error("BulkPdfJob batch {$this->batchId} failed: {$exception->getMessage()}");

        $batch = PdfBatch::find($this->batchId);
        if ($batch) {
            $batch->update([
                'status' => 'failed',
                'error' => $exception->getMessage(),
            ]);
        }
    }
}
