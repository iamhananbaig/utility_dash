<?php

namespace App\Services;

use App\Jobs\FetchBillJob;
use App\Models\FetchBatch;
use App\Models\Property;

class BillFetchService
{
    public function startBatch(?int $locationId = null, ?string $propertyType = null, ?string $provider = null): FetchBatch
    {
        $query = Property::forFetch($provider);

        if ($locationId !== null) {
            $query->where('location_id', $locationId);
        }

        if ($propertyType !== null) {
            $query->where('property_type', $propertyType);
        }

        $properties = $query->get();
        $referenceNumbers = $properties->pluck('reference_no')->values()->all();

        $batch = FetchBatch::create([
            'total_refs' => count($referenceNumbers),
            'status' => 'running',
            'started_at' => now(),
        ]);

        FetchBillJob::dispatch($batch->id, $referenceNumbers, $provider ?? 'iesco');

        return $batch;
    }
}
