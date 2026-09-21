<?php

namespace App\Jobs;

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

        $baseTag = '<base href="https://bill.pitc.com.pk/iescobill/" />';
        if (str_contains($content, '<head>')) {
            $content = str_replace('<head>', '<head>'.$baseTag, $content);
        } elseif (str_contains($content, '<HEAD>')) {
            $content = str_replace('<HEAD>', '<HEAD>'.$baseTag, $content);
        } else {
            $content = $baseTag.$content;
        }

        $qrInit = '<script>
(function(){
  var host = document.getElementById("charges_qrcode_1");
  var textEl = document.getElementById("charges_qr_text_1");
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

        $html = '<!DOCTYPE html><html><head>'
            .'<meta charset="utf-8">'
            .$baseTag
            .'<style>'
            .'@page { size: A4 portrait; margin: 10mm; }'
            .'body { margin: 0; padding: 0; }'
            .'.bill-loader, .bill-loader--hide, noscript { display: none !important; }'
            .'</style>'
            .'<link rel="stylesheet" href="CSS/bill-print.css?v='.time().'" />'
            .'</head><body>'
            .$content
            .$qrInit
            .'</body></html>';

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
