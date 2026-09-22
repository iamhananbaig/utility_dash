<?php

namespace App\Services;

use App\Imports\RawSpreadsheetImport;
use App\Models\Bill;
use App\Models\PaymentProof;
use Carbon\Carbon;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class PaymentService
{
    public function processExcelUpload(UploadedFile $file): array
    {
        $path = $file->store('payment-proofs', 'local');
        $fullPath = Storage::disk('local')->path($path);

        $import = new RawSpreadsheetImport;
        $import->load($fullPath);
        $spreadsheet = $import->rows;
        $matched = 0;
        $notFound = 0;
        $errors = [];

        if ($spreadsheet === null || $spreadsheet->isEmpty()) {
            return ['matched' => 0, 'not_found' => 0, 'errors' => ['Empty file']];
        }

        $headers = $spreadsheet->first();

        if ($headers instanceof Collection) {
            $headers = $headers->toArray();
        }

        $rows = $spreadsheet->slice(1);

        $refIndex = $this->findColumnIndex($headers, ['reference_no', 'reference', 'ref_no', 'refno']);
        $amountIndex = $this->findColumnIndex($headers, ['amount_paid', 'amount', 'paid_amount', 'payment_amount']);
        $dateIndex = $this->findColumnIndex($headers, ['date', 'payment_date', 'paid_date']);
        $instructionIndex = $this->findColumnIndex($headers, ['instruction_id', 'instruction']);
        $batchIndex = $this->findColumnIndex($headers, ['batch_no', 'batch']);
        $voucherIndex = $this->findColumnIndex($headers, ['voucher_no', 'voucher']);
        $payableIndex = $this->findColumnIndex($headers, ['payable', 'website_payable', 'bill_amount', 'payable_amount']);
        $statusIndex = $this->findColumnIndex($headers, ['status', 'payment_status']);

        if ($refIndex === null || $voucherIndex === null) {
            return ['matched' => 0, 'not_found' => 0, 'errors' => ['Required columns not found: reference_no, voucher_no']];
        }

        DB::transaction(function () use ($rows, $refIndex, $amountIndex, $dateIndex, $instructionIndex, $batchIndex, $voucherIndex, $payableIndex, $statusIndex, $path, $file, &$matched, &$notFound, &$errors) {
            foreach ($rows as $row) {
                $refNo = trim((string) ($row[$refIndex] ?? ''));
                $voucherNo = trim((string) ($row[$voucherIndex] ?? ''));

                if ($refNo === '' || $voucherNo === '') {
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
                $amountPaid = $amountIndex !== null ? (float) ($row[$amountIndex] ?? 0) : $bill->website_payable;
                $date = $dateIndex !== null ? $row[$dateIndex] : null;
                $payable = $payableIndex !== null ? (float) ($row[$payableIndex] ?? 0) : null;

                // Read status from Excel, default to in_process
                $status = 'in_process';
                if ($statusIndex !== null) {
                    $excelStatus = strtolower(trim((string) ($row[$statusIndex] ?? '')));
                    if (in_array($excelStatus, ['paid', 'in_process'])) {
                        $status = $excelStatus;
                    }
                }

                $updateData = [
                    'status' => $status,
                    'instruction_id' => $instructionId ?: null,
                    'batch_no' => $batchNo ?: null,
                    'voucher_no' => $voucherNo,
                    'payment_date' => $date ? Carbon::parse($date)->toDateString() : now()->toDateString(),
                ];

                if ($status === 'paid') {
                    $updateData['paid_at'] = now();
                    $updateData['paid_amount'] = $amountPaid > 0 ? $amountPaid : $bill->website_payable;
                }

                // Update payable amount if provided in Excel
                if ($payable !== null && $payable > 0) {
                    $updateData['website_payable'] = $payable;
                    $updateData['payable_difference'] = $bill->calculated_payable - $payable;
                }

                $bill->update($updateData);

                PaymentProof::create([
                    'bill_id' => $bill->id,
                    'file_path' => $path,
                    'file_type' => 'excel',
                    'original_name' => $file->getClientOriginalName(),
                    'notes' => "Voucher: {$voucherNo}, Status: {$status}",
                ]);

                $matched++;
            }
        });

        return ['matched' => $matched, 'not_found' => $notFound, 'errors' => $errors];
    }

    private function findColumnIndex(array $headers, array $candidates): ?int
    {
        foreach ($headers as $index => $header) {
            $normalized = strtolower(trim((string) $header));
            foreach ($candidates as $candidate) {
                if ($normalized === $candidate) {
                    return $index;
                }
            }
        }

        return null;
    }
}
