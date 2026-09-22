<?php

namespace App\Jobs;

use App\Helpers\PdfHelper;
use App\Models\ActivityLog;
use App\Models\Bill;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class GenerateBillPdfJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;

    public int $timeout = 60;

    public function __construct(
        public int $billId,
    ) {
        $this->queue = 'pdf';
    }

    public function handle(): void
    {
        $bill = Bill::with('property.location')->findOrFail($this->billId);

        if ($bill->raw_html_path === null) {
            return;
        }

        $content = Storage::disk('local')->get($bill->raw_html_path);
        $content = preg_replace('/<noscript>.*?<\/noscript>/is', '', $content);

        $baseTag = PdfHelper::baseTag();
        if (str_contains($content, '<head>')) {
            $content = str_replace('<head>', '<head>'.$baseTag, $content);
        } elseif (str_contains($content, '<HEAD>')) {
            $content = str_replace('<HEAD>', '<HEAD>'.$baseTag, $content);
        } else {
            $content = $baseTag.$content;
        }

        $html = PdfHelper::wrapSingleBill($content, $baseTag);

        $tempDir = sys_get_temp_dir();
        $tempHtml = $tempDir.'/bill_pdf_'.$this->billId.'_'.time().'.html';
        $tempPdf = $tempDir.'/bill_pdf_'.$this->billId.'_'.time().'.pdf';
        file_put_contents($tempHtml, $html);

        $scriptPath = base_path().'/../pdf-service/pdf-generator.js';
        $cmd = 'node '.escapeshellarg($scriptPath).' --file '.escapeshellarg($tempHtml).' --output '.escapeshellarg($tempPdf).' 2>&1';
        exec($cmd, $output, $returnCode);

        @unlink($tempHtml);

        if ($returnCode !== 0 || ! file_exists($tempPdf)) {
            @unlink($tempPdf);
            Log::error("PDF generation failed for bill {$this->billId}", ['output' => $output]);

            return;
        }

        // Save to storage
        $pdfPath = 'bills/pdfs/'.$bill->id.'.pdf';
        Storage::disk('local')->put($pdfPath, file_get_contents($tempPdf));
        @unlink($tempPdf);

        $bill->update(['pdf_generated_at' => now()]);

        Log::info("PDF generated for bill {$this->billId}: {$pdfPath}");

        ActivityLog::create([
            'type' => 'pdf',
            'status' => 'success',
            'message' => "PDF generated for bill #{$this->billId} ({$bill->property->reference_no} - {$bill->bill_month})",
            'details' => ['bill_id' => $this->billId, 'path' => $pdfPath],
        ]);
    }

    public function failed(\Throwable $exception): void
    {
        Log::error("PDF generation failed for bill {$this->billId}: {$exception->getMessage()}", [
            'bill_id' => $this->billId,
            'exception' => $exception,
        ]);

        ActivityLog::create([
            'type' => 'pdf',
            'status' => 'failed',
            'message' => "PDF generation failed for bill #{$this->billId}: {$exception->getMessage()}",
            'details' => ['bill_id' => $this->billId, 'error' => $exception->getMessage()],
        ]);
    }
}
