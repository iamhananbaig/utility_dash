<?php

namespace App\Jobs;

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

            $qrInit = '<script>
(function(){
  var host = document.getElementById("'.$prefix.'charges_qrcode_1");
  var textEl = document.getElementById("'.$prefix.'charges_qr_text_1");
  if (!host || !textEl) return;
  var text = textEl.value || textEl.textContent || "";
  if (!text.trim()) return;
  host.setAttribute("data-bill-qr-init", "1");
  import("https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm").then(function(module) {
    var QRCode = module.default;
    host.innerHTML = "";
    var canvas = document.createElement("canvas");
    canvas.className = "bill-qr-canvas bill-qr-canvas--charges";
    canvas.setAttribute("role", "img");
    host.appendChild(canvas);
    return QRCode.toCanvas(canvas, text, {
      errorCorrectionLevel: "L",
      width: 300,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" }
    });
  }).then(function() {
    if (host.firstChild) {
      host.firstChild.style.width = "150px";
      host.firstChild.style.height = "150px";
    }
  }).catch(function(){});
})();
</script>';

            $htmlParts[] = '<div class="bill-page">'.$content.$qrInit.'</div>';
            $idx++;
        }

        if (empty($htmlParts)) {
            $batch->update(['status' => 'failed', 'error' => 'No bills with HTML content found']);

            return;
        }

        $html = '<!DOCTYPE html><html><head>'
            .'<meta charset="utf-8">'
            .$baseTag
            .'<style>'
            .'@page { size: A4 portrait; margin: 10mm; }'
            .'.bill-page { page-break-after: always; }'
            .'.bill-page:last-child { page-break-after: auto; }'
            .'body { margin: 0; padding: 0; }'
            .'.bill-loader, .bill-loader--hide, noscript { display: none !important; }'
            .'</style>'
            .'<link rel="stylesheet" href="CSS/bill-print.css?v='.time().'" />'
            .'</head><body>'
            .implode("\n", $htmlParts)
            .'</body></html>';

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
