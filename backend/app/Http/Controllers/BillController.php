<?php

namespace App\Http\Controllers;

use App\Exports\BillsExport;
use App\Imports\RawSpreadsheetImport;
use App\Jobs\BulkPdfJob;
use App\Jobs\GenerateBillPdfJob;
use App\Models\Bill;
use App\Models\PdfBatch;
use App\Models\Property;
use App\Traits\HandlesBillMonths;
use App\Traits\HandlesSpreadsheetColumns;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class BillController extends Controller
{
    use HandlesBillMonths, HandlesSpreadsheetColumns;

    public function index(Request $request): JsonResponse
    {
        $query = Bill::with('property.location');

        if ($request->has('status') && $request->status !== null) {
            $query->where('bills.status', $request->status);
        }

        if ($request->has('location_id') && $request->location_id !== null) {
            $query->where('property_id', function ($q) use ($request) {
                $q->select('id')->from('properties')->where('location_id', $request->location_id);
            });
        }

        if ($request->has('property_id') && $request->property_id !== null) {
            $query->where('property_id', $request->property_id);
        }

        if ($request->has('bill_month') && $request->bill_month !== null) {
            $query->where('bill_month', $request->bill_month);
        }

        if ($request->has('search') && $request->search !== null) {
            $search = $request->search;
            $query->whereHas('property', function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('reference_no', 'like', "%{$search}%");
            });
        }

        $bills = $query->orderByDesc('bill_month')->paginate($request->input('per_page', 50));

        return response()->json($bills);
    }

    public function process(Request $request, int $id): JsonResponse
    {
        $bill = Bill::findOrFail($id);

        $validated = $request->validate([
            'instruction_id' => 'nullable|string|max:255',
            'batch_no' => 'nullable|string|max:255',
            'voucher_no' => 'required|string|max:255',
            'payment_date' => 'nullable|date',
        ]);

        $bill->update([
            'status' => 'in_process',
            'instruction_id' => $validated['instruction_id'] ?? null,
            'batch_no' => $validated['batch_no'] ?? null,
            'voucher_no' => $validated['voucher_no'],
            'payment_date' => $validated['payment_date'] ?? now()->toDateString(),
        ]);

        return response()->json($bill->fresh('property'));
    }

    public function manualPayment(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'reference_no' => 'required|string|max:255',
            'bill_month' => 'required|string|max:255',
            'voucher_no' => 'required|string|max:255',
            'instruction_id' => 'nullable|string|max:255',
            'batch_no' => 'nullable|string|max:255',
            'payment_date' => 'nullable|date',
            'status' => 'required|in:in_process,paid',
        ]);

        $bill = Bill::whereHas('property', function ($q) use ($validated) {
            $q->where('reference_no', $validated['reference_no']);
        })->where('bill_month', strtoupper($validated['bill_month']))->first();

        if (! $bill) {
            return response()->json(['message' => 'Bill not found for reference: '.$validated['reference_no'].' month: '.$validated['bill_month']], 404);
        }

        $updateData = [
            'status' => $validated['status'],
            'instruction_id' => $validated['instruction_id'] ?? null,
            'batch_no' => $validated['batch_no'] ?? null,
            'voucher_no' => $validated['voucher_no'],
            'payment_date' => $validated['payment_date'] ?? now()->toDateString(),
        ];

        if ($validated['status'] === 'paid') {
            $updateData['paid_at'] = now();
            $updateData['paid_amount'] = $bill->website_payable;
        }

        $bill->update($updateData);

        return response()->json([
            'message' => "Bill {$bill->property->reference_no} marked as {$validated['status']}",
            'bill' => $bill->fresh('property'),
        ]);
    }

    public function markPaid(int $id): JsonResponse
    {
        $bill = Bill::findOrFail($id);

        if ($bill->status !== 'in_process') {
            return response()->json(['message' => 'Bill must be in process before marking as paid'], 422);
        }

        $bill->update([
            'status' => 'paid',
            'paid_at' => now(),
            'paid_amount' => $bill->website_payable,
        ]);

        return response()->json($bill->fresh('property'));
    }

    public function markPaidWithDetails(Request $request, int $id): JsonResponse
    {
        $bill = Bill::findOrFail($id);

        $validated = $request->validate([
            'batch_no' => 'required|string|max:255',
            'instruction_id' => 'required|string|max:255',
            'payment_date' => 'nullable|date',
        ]);

        $batchNo = $validated['batch_no'];
        $instructionId = $validated['instruction_id'];

        // Validation: if batch = SI, only one bill at a time
        if (strtolower($batchNo) === 'si' && $bill->status !== 'in_process') {
            return response()->json(['message' => 'For SI batch, bill must be in process first'], 422);
        }

        // Validation: same instruction no cannot be used for multiple bills
        if ($instructionId !== null) {
            $existing = Bill::where('instruction_id', $instructionId)
                ->where('id', '!=', $id)
                ->exists();
            if ($existing) {
                return response()->json(['message' => "Instruction ID '{$instructionId}' is already used for another bill"], 422);
            }
        }

        $bill->update([
            'status' => 'paid',
            'paid_at' => now(),
            'paid_amount' => $bill->website_payable,
            'batch_no' => $batchNo,
            'instruction_id' => $instructionId,
            'payment_date' => $validated['payment_date'] ?? now()->toDateString(),
        ]);

        return response()->json($bill->fresh('property'));
    }

    public function bulkMarkPaid(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
            'batch_no' => 'required|string|max:255',
            'instruction_id' => 'required|string|max:255',
            'payment_date' => 'nullable|date',
        ]);

        $batchNo = $validated['batch_no'];
        $instructionId = $validated['instruction_id'];

        // Validation: if batch = SI, only one bill allowed
        if (strtolower($batchNo) === 'si' && count($validated['ids']) > 1) {
            return response()->json(['message' => 'For SI batch, only one bill can be marked as paid at a time'], 422);
        }

        // Validation: same instruction no cannot be used for multiple bills
        $usedElsewhere = Bill::where('instruction_id', $instructionId)
            ->whereNotIn('id', $validated['ids'])
            ->exists();
        if ($usedElsewhere) {
            return response()->json(['message' => "Instruction ID '{$instructionId}' is already used for another bill"], 422);
        }

        $updated = 0;
        foreach ($validated['ids'] as $billId) {
            $bill = Bill::find($billId);
            if (! $bill) {
                continue;
            }

            $bill->update([
                'status' => 'paid',
                'paid_at' => now(),
                'paid_amount' => $bill->website_payable,
                'batch_no' => $batchNo,
                'instruction_id' => $instructionId,
                'payment_date' => $validated['payment_date'] ?? now()->toDateString(),
            ]);
            $updated++;
        }

        return response()->json([
            'message' => "Marked {$updated} bill(s) as paid",
            'updated' => $updated,
        ]);
    }

    public function bulkProcess(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240',
        ]);

        $file = $request->file('file');
        $path = $file->store('payment-proofs', 'local');
        $fullPath = Storage::disk('local')->path($path);

        $spreadsheet = Excel::toCollection(null, $fullPath)->first();

        if ($spreadsheet === null || $spreadsheet->isEmpty()) {
            return response()->json(['message' => 'Empty file'], 422);
        }

        $headers = $spreadsheet->first();
        $rows = $spreadsheet->slice(1);

        $refIndex = $this->findColumnIndex($headers, ['reference_no', 'reference', 'ref_no', 'refno']);
        $instructionIndex = $this->findColumnIndex($headers, ['instruction_id', 'instruction']);
        $batchIndex = $this->findColumnIndex($headers, ['batch_no', 'batch']);
        $voucherIndex = $this->findColumnIndex($headers, ['voucher_no', 'voucher']);
        $dateIndex = $this->findColumnIndex($headers, ['date', 'payment_date']);

        if ($refIndex === null || $voucherIndex === null) {
            return response()->json(['message' => 'Required columns not found: reference_no, voucher_no'], 422);
        }

        $processed = 0;
        $skipped = 0;
        $notFound = 0;
        $errors = [];

        DB::transaction(function () use ($rows, $refIndex, $instructionIndex, $batchIndex, $voucherIndex, $dateIndex, &$processed, &$skipped, &$notFound, &$errors) {
            foreach ($rows as $row) {
                $refNo = trim((string) ($row[$refIndex] ?? ''));
                $voucherNo = trim((string) ($row[$voucherIndex] ?? ''));

                if ($refNo === '' || $voucherNo === '') {
                    $skipped++;

                    continue;
                }

                $bill = Bill::whereHas('property', function ($q) use ($refNo) {
                    $q->where('reference_no', $refNo);
                })->first();

                if ($bill === null) {
                    $notFound++;

                    continue;
                }

                $instructionId = $instructionIndex !== null ? trim((string) ($row[$instructionIndex] ?? '')) : null;
                $batchNo = $batchIndex !== null ? trim((string) ($row[$batchIndex] ?? '')) : null;
                $date = $dateIndex !== null ? $row[$dateIndex] : null;

                $bill->update([
                    'status' => 'in_process',
                    'instruction_id' => $instructionId ?: null,
                    'batch_no' => $batchNo ?: null,
                    'voucher_no' => $voucherNo,
                    'payment_date' => $date ? Carbon::parse($date)->toDateString() : now()->toDateString(),
                ]);

                $processed++;
            }
        });

        return response()->json([
            'message' => "Processed: {$processed}, Not found: {$notFound}, Skipped: {$skipped}",
            'processed' => $processed,
            'not_found' => $notFound,
            'skipped' => $skipped,
        ]);
    }

    public function updateStatus(Request $request, int $id): JsonResponse
    {
        $bill = Bill::findOrFail($id);

        $validated = $request->validate([
            'status' => 'required|in:unpaid,in_process,paid,disputed,cancelled',
            'payment_note' => 'nullable|string',
        ]);

        $bill->update($validated);

        return response()->json($bill->fresh('property'));
    }

    public function updateAmount(Request $request, int $id): JsonResponse
    {
        $bill = Bill::findOrFail($id);

        if ($bill->status === 'paid') {
            return response()->json(['message' => 'Cannot change amount after bill is marked as paid'], 422);
        }

        $validated = $request->validate([
            'website_payable' => 'required|numeric|min:0',
        ]);

        $bill->update([
            'website_payable' => $validated['website_payable'],
            'payable_difference' => $bill->calculated_payable - $validated['website_payable'],
        ]);

        return response()->json($bill->fresh('property'));
    }

    public function showHtml(int $id): Response
    {
        $bill = Bill::findOrFail($id);

        if ($bill->raw_html_path === null) {
            abort(404, 'Raw HTML not available');
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

        return response($content, 200, [
            'Content-Type' => 'text/html; charset=utf-8',
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
            'Pragma' => 'no-cache',
        ]);
    }

    public function export(Request $request): BinaryFileResponse
    {
        $query = Bill::with('property.location');

        if ($request->has('status') && $request->status !== null) {
            $query->where('bills.status', $request->status);
        }

        if ($request->has('location_id') && $request->location_id !== null) {
            $query->where('property_id', function ($q) use ($request) {
                $q->select('id')->from('properties')->where('location_id', $request->location_id);
            });
        }

        if ($request->has('bill_month') && $request->bill_month !== null) {
            $query->where('bill_month', $request->bill_month);
        }

        $bills = $query->orderByDesc('bill_month')->get();

        return Excel::download(
            new BillsExport($bills),
            'bills_export.xlsx'
        );
    }

    public function pdf(int $id): Response
    {
        $bill = Bill::with('property.location')->findOrFail($id);

        // Serve cached PDF if available
        if ($bill->pdf_generated_at) {
            $pdfPath = 'bills/pdfs/'.$bill->id.'.pdf';
            if (Storage::disk('local')->exists($pdfPath)) {
                $pdfContent = Storage::disk('local')->get($pdfPath);
                $fileName = 'bill_'.$bill->property->reference_no.'_'.$bill->bill_month.'.pdf';

                return response($pdfContent, 200, [
                    'Content-Type' => 'application/pdf',
                    'Content-Disposition' => 'inline; filename="'.$fileName.'"',
                    'Cache-Control' => 'no-store, no-cache, must-revalidate',
                ]);
            }
        }

        // Generate on-the-fly if no cached PDF
        if ($bill->raw_html_path === null) {
            abort(404, 'Raw HTML not available');
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

        // Wrap in print HTML with QR initialization script
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

        // Write temp HTML file
        $tempDir = sys_get_temp_dir();
        $tempHtml = $tempDir.'/bill_'.$id.'_'.time().'.html';
        $tempPdf = $tempDir.'/bill_'.$id.'_'.time().'.pdf';
        file_put_contents($tempHtml, $html);

        // Call Node.js PDF generator
        $scriptPath = base_path().'/../pdf-service/pdf-generator.js';
        $cmd = 'node '.escapeshellarg($scriptPath).' --file '.escapeshellarg($tempHtml).' --output '.escapeshellarg($tempPdf).' 2>&1';
        exec($cmd, $output, $returnCode);

        // Cleanup temp HTML
        @unlink($tempHtml);

        if ($returnCode !== 0 || ! file_exists($tempPdf)) {
            @unlink($tempPdf);
            abort(500, 'PDF generation failed: '.implode("\n", $output));
        }

        $pdfContent = file_get_contents($tempPdf);
        @unlink($tempPdf);

        $fileName = 'bill_'.$bill->property->reference_no.'_'.$bill->bill_month.'.pdf';

        return response($pdfContent, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="'.$fileName.'"',
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
        ]);
    }

    public function bulkPdf(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'integer',
        ]);

        $batch = PdfBatch::create([
            'bill_count' => count($validated['ids']),
        ]);

        BulkPdfJob::dispatch($batch->id, $validated['ids']);

        return response()->json([
            'message' => 'PDF generation queued',
            'batch_id' => $batch->id,
            'bill_count' => $batch->bill_count,
        ], 202);
    }

    public function pdfBatchStatus(int $id): JsonResponse
    {
        $batch = PdfBatch::findOrFail($id);

        return response()->json([
            'batch_id' => $batch->id,
            'status' => $batch->status,
            'bill_count' => $batch->bill_count,
            'pdf_path' => $batch->pdf_path,
            'error' => $batch->error,
        ]);
    }

    public function pdfBatchDownload(int $id): \Symfony\Component\HttpFoundation\Response
    {
        $batch = PdfBatch::findOrFail($id);

        if ($batch->status !== 'completed' || $batch->pdf_path === null) {
            abort(404, 'PDF not ready');
        }

        $fullPath = Storage::disk('local')->path($batch->pdf_path);

        if (! file_exists($fullPath)) {
            abort(404, 'PDF file not found');
        }

        return response()->file($fullPath, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="bills_batch_'.$id.'.pdf"',
        ]);
    }

    public function generatePdf(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => 'nullable|array',
            'ids.*' => 'integer',
            'bill_month' => 'nullable|string',
        ]);

        $query = Bill::whereNull('pdf_generated_at')->whereNotNull('raw_html_path');

        if (! empty($validated['ids'])) {
            $query->whereIn('id', $validated['ids']);
        }

        if (! empty($validated['bill_month'])) {
            $query->where('bill_month', $validated['bill_month']);
        }

        $bills = $query->pluck('id');
        $count = $bills->count();

        if ($count === 0) {
            return response()->json(['message' => 'No pending PDFs to generate', 'queued' => 0]);
        }

        foreach ($bills as $billId) {
            GenerateBillPdfJob::dispatch($billId);
        }

        return response()->json([
            'message' => "Queued {$count} PDF(s) for generation",
            'queued' => $count,
        ]);
    }

    public function pdfStatus(): JsonResponse
    {
        $total = Bill::whereNotNull('raw_html_path')->count();
        $generated = Bill::whereNotNull('pdf_generated_at')->count();
        $pending = $total - $generated;

        // Count jobs in the pdf queue
        $redis = app('redis');
        $pendingJobs = 0;
        $reservedJobs = 0;
        try {
            $pendingJobs = (int) $redis->llen('queues:pdf');
            $reservedJobs = (int) $redis->scard('queues:pdf:reserved') ?? 0;
        } catch (\Throwable) {
            // Redis not available
        }

        return response()->json([
            'total' => $total,
            'generated' => $generated,
            'pending' => $pending,
            'jobs_pending' => $pendingJobs,
            'jobs_running' => $reservedJobs,
        ]);
    }

    public function import(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240',
        ]);

        $file = $request->file('file');
        $path = $file->store('imports', 'local');
        $fullPath = Storage::disk('local')->path($path);

        $import = new RawSpreadsheetImport;
        $import->load($fullPath);
        $spreadsheet = $import->rows;

        if ($spreadsheet === null || $spreadsheet->isEmpty()) {
            return response()->json(['message' => 'Empty file'], 422);
        }

        $headers = $spreadsheet->first();

        if ($headers instanceof Collection) {
            $headers = $headers->toArray();
        }

        $rows = $spreadsheet->slice(1);

        $refIndex = $this->findColumnIndex($headers, ['reference_no', 'ref_no', 'refno']);
        $monthIndex = $this->findColumnIndex($headers, ['bill_month', 'month']);
        $amountIndex = $this->findColumnIndex($headers, ['website_payable', 'amount', 'payable', 'bill_amount']);
        $unitsIndex = $this->findColumnIndex($headers, ['units', 'kwh', 'energy_units']);
        $issueDateIndex = $this->findColumnIndex($headers, ['issue_date']);
        $dueDateIndex = $this->findColumnIndex($headers, ['due_date']);
        $statusIndex = $this->findColumnIndex($headers, ['status', 'payment_status']);

        if ($refIndex === null || $monthIndex === null || $amountIndex === null) {
            return response()->json(['message' => 'Required columns not found: reference_no, bill_month, website_payable'], 422);
        }

        $imported = 0;
        $skipped = 0;
        $errors = [];

        DB::transaction(function () use ($rows, $refIndex, $monthIndex, $amountIndex, $unitsIndex, $issueDateIndex, $dueDateIndex, $statusIndex, &$imported, &$skipped, &$errors) {
            foreach ($rows as $row) {
                $refNo = trim((string) ($row[$refIndex] ?? ''));
                $billMonth = strtoupper(trim((string) ($row[$monthIndex] ?? '')));
                $amount = (float) ($row[$amountIndex] ?? 0);

                if ($refNo === '' || $billMonth === '' || $amount <= 0) {
                    $skipped++;
                    $errors[] = "{$refNo}: missing ref, month, or amount";

                    continue;
                }

                $property = Property::where('reference_no', $refNo)->first();
                if (! $property) {
                    $skipped++;
                    $errors[] = "{$refNo}: property not found";

                    continue;
                }

                // Normalize bill_month to "MMM YY" format
                $parsed = $this->parseBillMonth($billMonth);
                if (! $parsed) {
                    $skipped++;
                    $errors[] = "{$refNo}: invalid month format '{$billMonth}'";

                    continue;
                }
                $normalizedMonth = strtoupper($parsed->format('M y'));

                // Skip if bill already exists
                $existing = Bill::where('property_id', $property->id)
                    ->where('bill_month', $normalizedMonth)
                    ->first();

                if ($existing) {
                    $skipped++;

                    continue;
                }

                $units = $unitsIndex !== null ? (float) ($row[$unitsIndex] ?? 0) : 0;

                $billData = [
                    'property_id' => $property->id,
                    'provider' => $property->provider,
                    'bill_month' => $normalizedMonth,
                    'website_payable' => $amount,
                    'status' => 'unpaid',
                    'fetched_at' => now(),
                ];

                if ($issueDateIndex !== null) {
                    $billData['issue_date'] = trim((string) ($row[$issueDateIndex] ?? ''));
                }
                if ($dueDateIndex !== null) {
                    $billData['due_date'] = trim((string) ($row[$dueDateIndex] ?? ''));
                }
                if ($statusIndex !== null) {
                    $statusVal = strtolower(trim((string) ($row[$statusIndex] ?? '')));
                    if (in_array($statusVal, ['paid', 'unpaid', 'disputed', 'cancelled'])) {
                        $billData['status'] = $statusVal;
                    }
                }

                // Store units in raw_data if provided
                if ($units > 0) {
                    $billData['raw_data'] = ['ENERGY_DETAILS_UNITS' => $units];
                }

                Bill::create($billData);
                $imported++;
            }
        });

        return response()->json([
            'message' => "Imported {$imported} bills, skipped {$skipped}",
            'imported' => $imported,
            'skipped' => $skipped,
            'errors' => $errors,
        ]);
    }
}
