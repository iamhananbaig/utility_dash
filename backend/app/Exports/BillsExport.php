<?php

namespace App\Exports;

use App\Models\Bill;
use Illuminate\Support\Collection;
use Maatwebsite\Excel\Concerns\FromCollection;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;
use Maatwebsite\Excel\Concerns\WithStyles;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

class BillsExport implements FromCollection, WithHeadings, WithMapping, WithStyles
{
    private array $extraColumns = [];

    public function __construct(
        public Collection $bills,
    ) {
        // Discover all extra columns from raw_data across all bills
        $allKeys = [];
        foreach ($bills as $bill) {
            if (is_array($bill->raw_data)) {
                foreach ($bill->raw_data as $key => $value) {
                    if (! in_array($key, $allKeys)) {
                        $allKeys[] = $key;
                    }
                }
            }
        }
        // Remove _RAW_HTML and already-mapped keys
        $mappedKeys = [
            'INPUT_REFERENCE_NO', 'RETURNED_REFERENCE_NO', 'REFERENCE_VERIFICATION',
            'BILL_MONTH', 'READING_DATE', 'ISSUE_DATE', 'DUE_DATE',
            'ARREARS_RAW', 'ARREARS_AMOUNT', 'ENERGY_DETAILS_TOTAL',
            'TAXES_TOTAL', 'TAXES_ON_FPA_TOTAL',
            'CALCULATED_PAYABLE_WITHIN_DUE_DATE', 'WEBSITE_PAYABLE_WITHIN_DUE_DATE',
            'WEBSITE_PAYABLE_SOURCE', 'PAYABLE_DIFFERENCE', 'PAYABLE_COMPARISON',
            'HISTORY_FIRST_MONTH', 'HISTORY_FIRST_KWH_UNITS', 'HISTORY_FIRST_BILL_RS',
            'HISTORY_LAST_MONTH', 'HISTORY_LAST_KWH_UNITS', 'HISTORY_LAST_BILL_RS',
            'HISTORY_STATUS', 'FETCHED_AT', 'FETCH_STATUS', 'ERROR',
        ];
        $this->extraColumns = array_values(array_diff($allKeys, $mappedKeys, ['_RAW_HTML']));
    }

    public function collection(): Collection
    {
        return $this->bills;
    }

    public function headings(): array
    {
        $base = [
            'Property Name',
            'Provider',
            'Reference No',
            'Returned Reference No',
            'Reference Verification',
            'Meter No',
            'Location',
            'Property Type',
            'Bill Month',
            'Issue Date',
            'Reading Date',
            'Due Date',
            'Arrears (Raw)',
            'Arrears Amount',
            'Energy Charges',
            'Taxes Total',
            'FPA Taxes Total',
            'Advance Tax',
            'Surcharge',
            'Payable After Due Date',
            'Calculated Payable',
            'Website Payable',
            'Website Payable Source',
            'Payable Difference',
            'Comparison Status',
            'History First Month',
            'History First kWh',
            'History First Bill Rs',
            'History Last Month',
            'History Last kWh',
            'History Last Bill Rs',
            'History Status',
            'Fetch Status',
            'Fetch Error',
            'Instruction ID',
            'Batch No',
            'Voucher No',
            'Payment Date',
            'Status',
            'Paid At',
            'Paid Amount',
            'Fetched At',
        ];

        return array_merge($base, $this->extraColumns);
    }

    public function map(mixed $row): array
    {
        /** @var Bill $bill */
        $bill = $row;
        $rawData = is_array($bill->raw_data) ? $bill->raw_data : [];

        $base = [
            $bill->property->name ?? '',
            $bill->property->provider ?? '',
            $bill->property->reference_no ?? '',
            $bill->returned_reference_no ?? '',
            $bill->reference_verification ?? '',
            $bill->property->meter_no ?? '',
            $bill->property->location->code ?? '',
            $bill->property->property_type ?? '',
            $bill->bill_month ?? '',
            $bill->issue_date ?? '',
            $bill->reading_date ?? '',
            $bill->due_date ?? '',
            $bill->arrears_raw ?? '',
            $bill->arrears_amount,
            $bill->energy_charges,
            $bill->taxes_total,
            $bill->fpa_taxes_total,
            $bill->advance_tax,
            $bill->surcharge,
            $bill->payable_after_due_date,
            $bill->calculated_payable,
            $bill->website_payable,
            $bill->website_payable_source ?? '',
            $bill->payable_difference,
            $bill->comparison_status ?? '',
            $bill->history_first_month ?? '',
            $bill->history_first_kwh_units,
            $bill->history_first_bill_rs,
            $bill->history_last_month ?? '',
            $bill->history_last_kwh_units,
            $bill->history_last_bill_rs,
            $bill->history_status ?? '',
            $rawData['FETCH_STATUS'] ?? '',
            $rawData['ERROR'] ?? '',
            $bill->instruction_id ?? '',
            $bill->batch_no ?? '',
            $bill->voucher_no ?? '',
            $bill->payment_date?->format('Y-m-d') ?? '',
            $bill->status,
            $bill->paid_at?->format('Y-m-d H:i') ?? '',
            $bill->paid_amount ?? '',
            $bill->fetched_at?->format('Y-m-d H:i') ?? '',
        ];

        // Append all extra QR-parsed columns from raw_data
        $extras = [];
        foreach ($this->extraColumns as $key) {
            $extras[] = $rawData[$key] ?? '';
        }

        return array_merge($base, $extras);
    }

    public function styles(Worksheet $sheet): array
    {
        return [
            1 => ['font' => ['bold' => true]],
        ];
    }
}
