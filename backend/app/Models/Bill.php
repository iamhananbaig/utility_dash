<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Bill extends Model
{
    protected $fillable = [
        'property_id',
        'provider',
        'bill_month',
        'issue_date',
        'reading_date',
        'due_date',
        'arrears_amount',
        'arrears_raw',
        'energy_charges',
        'taxes_total',
        'fpa_taxes_total',
        'advance_tax',
        'surcharge',
        'payable_after_due_date',
        'calculated_payable',
        'website_payable',
        'payable_difference',
        'comparison_status',
        'history_first_month',
        'history_first_kwh_units',
        'history_first_bill_rs',
        'history_last_month',
        'history_last_kwh_units',
        'history_last_bill_rs',
        'history_status',
        'website_payable_source',
        'returned_reference_no',
        'reference_verification',
        'status',
        'paid_at',
        'paid_amount',
        'payment_note',
        'instruction_id',
        'batch_no',
        'voucher_no',
        'payment_date',
        'raw_data',
        'raw_html_path',
        'pdf_generated_at',
        'fetched_at',
    ];

    protected function casts(): array
    {
        return [
            'arrears_amount' => 'decimal:2',
            'energy_charges' => 'decimal:2',
            'taxes_total' => 'decimal:2',
            'fpa_taxes_total' => 'decimal:2',
            'advance_tax' => 'decimal:2',
            'surcharge' => 'decimal:2',
            'payable_after_due_date' => 'decimal:2',
            'calculated_payable' => 'decimal:2',
            'website_payable' => 'decimal:2',
            'payable_difference' => 'decimal:2',
            'paid_amount' => 'decimal:2',
            'history_first_kwh_units' => 'decimal:2',
            'history_first_bill_rs' => 'decimal:2',
            'history_last_kwh_units' => 'decimal:2',
            'history_last_bill_rs' => 'decimal:2',
            'raw_data' => 'array',
            'paid_at' => 'datetime',
            'payment_date' => 'date',
            'pdf_generated_at' => 'datetime',
            'fetched_at' => 'datetime',
        ];
    }

    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    public function paymentProofs(): HasMany
    {
        return $this->hasMany(PaymentProof::class);
    }
}
