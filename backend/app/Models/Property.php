<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Property extends Model
{
    protected $fillable = [
        'name',
        'reference_no',
        'provider',
        'meter_no',
        'location_id',
        'property_type',
        'status',
        'notes',
    ];

    protected function casts(): array
    {
        return [];
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(Location::class);
    }

    public function bills(): HasMany
    {
        return $this->hasMany(Bill::class);
    }

    public function referenceHistories(): HasMany
    {
        return $this->hasMany(ReferenceHistory::class);
    }

    public function latestBill(): HasMany
    {
        return $this->bills()->latest('bill_month');
    }

    public function unpaidBills(): HasMany
    {
        return $this->bills()->where('status', 'unpaid');
    }

    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }

    public function scopeForFetch($query, ?string $provider = null)
    {
        $query->active()->whereNotNull('reference_no')->where('reference_no', '!=', '');

        if ($provider !== null) {
            $query->where('provider', $provider);
        }

        return $query;
    }
}
