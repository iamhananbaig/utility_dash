<?php

use App\Jobs\FetchBillJob;
use App\Models\ActivityLog;
use App\Models\Bill;
use App\Models\FetchBatch;
use App\Models\Property;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Sleep;

uses(LazilyRefreshDatabase::class);

beforeEach(function () {
    config(['services.python_api.url' => 'http://python.test']);
    Http::preventStrayRequests();
    Sleep::fake();
    Storage::fake('local');
});

it('saves fetched bills and completes the batch', function () {
    $property = Property::factory()->create();
    $batch = FetchBatch::factory()->create();

    Http::fake([
        'python.test/iesco/fetch' => Http::response(['task_id' => 'task-1', 'total' => 1]),
        'python.test/iesco/status/task-1' => Http::response([
            'status' => 'completed', 'completed' => 1, 'success_count' => 1, 'fail_count' => 0,
        ]),
        'python.test/iesco/results/task-1' => Http::response([
            $property->reference_no => [
                'FETCH_STATUS' => 'SUCCESS',
                'BILL_MONTH' => 'JAN 26',
                'WEBSITE_PAYABLE_WITHIN_DUE_DATE' => 1500,
                '_RAW_HTML' => '<html>bill</html>',
            ],
        ]),
    ]);

    app()->call([new FetchBillJob($batch->id, [$property->reference_no]), 'handle']);

    expect($batch->fresh())
        ->status->toBe('completed')
        ->success_count->toBe(1);

    $bill = Bill::sole();
    expect($bill->property_id)->toBe($property->id)
        ->and($bill->bill_month)->toBe('JAN 26');
    Storage::disk('local')->assertExists($bill->raw_html_path);
});

it('throws when the python task disappears mid-fetch', function () {
    $property = Property::factory()->create();
    $batch = FetchBatch::factory()->create();

    Http::fake([
        'python.test/iesco/fetch' => Http::response(['task_id' => 'task-1', 'total' => 1]),
        'python.test/iesco/status/task-1' => Http::response(['status' => 'not_found']),
    ]);

    app()->call([new FetchBillJob($batch->id, [$property->reference_no]), 'handle']);
})->throws(RuntimeException::class, 'was lost');

it('gives up after repeated status errors instead of polling forever', function () {
    $property = Property::factory()->create();
    $batch = FetchBatch::factory()->create();

    Http::fake([
        'python.test/iesco/fetch' => Http::response(['task_id' => 'task-1', 'total' => 1]),
        'python.test/iesco/status/task-1' => Http::response('down', 503),
    ]);

    app()->call([new FetchBillJob($batch->id, [$property->reference_no]), 'handle']);
})->throws(RuntimeException::class, 'stopped responding');

it('throws when the results endpoint reports an error', function () {
    $property = Property::factory()->create();
    $batch = FetchBatch::factory()->create();

    Http::fake([
        'python.test/iesco/fetch' => Http::response(['task_id' => 'task-1', 'total' => 1]),
        'python.test/iesco/status/task-1' => Http::response(['status' => 'completed', 'completed' => 1]),
        'python.test/iesco/results/task-1' => Http::response(['error' => 'No results available']),
    ]);

    app()->call([new FetchBillJob($batch->id, [$property->reference_no]), 'handle']);
})->throws(RuntimeException::class, 'No results available');

it('polls the status endpoint of the requested provider', function () {
    $property = Property::factory()->create(['provider' => 'vcard']);
    $batch = FetchBatch::factory()->create();

    Http::fake([
        'python.test/vcard/fetch' => Http::response(['task_id' => 'task-1', 'total' => 1]),
        'python.test/vcard/status/task-1' => Http::response(['status' => 'completed', 'completed' => 1]),
        'python.test/vcard/results/task-1' => Http::response([]),
    ]);

    app()->call([new FetchBillJob($batch->id, [$property->reference_no], 'vcard'), 'handle']);

    expect($batch->fresh()->status)->toBe('completed');
});

it('marks the batch as failed and logs the error when the job fails', function () {
    $batch = FetchBatch::factory()->create();

    (new FetchBillJob($batch->id, ['123']))->failed(new RuntimeException('python down'));

    expect($batch->fresh())
        ->status->toBe('failed')
        ->error_log->toBe(['error' => 'python down']);
    expect(ActivityLog::sole())
        ->status->toBe('failed')
        ->batch_id->toBe($batch->id);
});
