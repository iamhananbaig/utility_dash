<?php

namespace App\Helpers;

class PdfHelper
{
    private const BASE_TAG = '<base href="https://bill.pitc.com.pk/iescobill/" />';

    private const CSS = '@page { size: A4 portrait; margin: 10mm; }
body { margin: 0; padding: 0; }
.bill-loader, .bill-loader--hide, noscript { display: none !important; }';

    public static function baseTag(): string
    {
        return self::BASE_TAG;
    }

    public static function qrInitScript(string $prefix = ''): string
    {
        $chargesId = $prefix ? $prefix.'charges_qrcode_1' : 'charges_qrcode_1';
        $textId = $prefix ? $prefix.'charges_qr_text_1' : 'charges_qr_text_1';

        return '<script>
(function(){
  var host = document.getElementById("'.$chargesId.'");
  var textEl = document.getElementById("'.$textId.'");
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
    }

    public static function wrapSingleBill(string $content, ?string $baseTag = null): string
    {
        $base = $baseTag ?? self::BASE_TAG;

        return '<!DOCTYPE html><html><head>'
            .'<meta charset="utf-8">'
            .$base
            .'<style>'.self::CSS.'</style>'
            .'<link rel="stylesheet" href="CSS/bill-print.css?v='.time().'" />'
            .'</head><body>'
            .$content
            .self::qrInitScript()
            .'</body></html>';
    }

    public static function wrapBulkBills(array $htmlParts, ?string $baseTag = null): string
    {
        $base = $baseTag ?? self::BASE_TAG;

        return '<!DOCTYPE html><html><head>'
            .'<meta charset="utf-8">'
            .$base
            .'<style>'
            .self::CSS
            ."\n"
            .'.bill-page { page-break-after: always; }'
            .'.bill-page:last-child { page-break-after: auto; }'
            .'</style>'
            .'<link rel="stylesheet" href="CSS/bill-print.css?v='.time().'" />'
            .'</head><body>'
            .implode("\n", $htmlParts)
            .'</body></html>';
    }
}
