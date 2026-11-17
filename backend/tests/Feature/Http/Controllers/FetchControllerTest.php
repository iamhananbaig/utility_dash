<?php

use App\Models\FetchBatch;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;

uses(LazilyRefreshDatabase::class);

it('returns 204 with an empty body when no fetch batch exists', function () {
    $this->getJson('/api/fetch/latest')
        ->assertNoContent();
});

it('returns the most recent fetch batch', function () {
    FetchBatch::factory()->create(['created_at' => now()->subHour()]);
    $latest = FetchBatch::factory()->create(['total_refs' => 4, 'completed' => 1]);

    $this->getJson('/api/fetch/latest')
        ->assertOk()
        ->assertExactJson([
            'batch_id' => $latest->id,
            'status' => 'running',
            'total_refs' => 4,
            'completed' => 1,
            'success_count' => 0,
            'fail_count' => 0,
            'progress' => 25,
        ]);
});
