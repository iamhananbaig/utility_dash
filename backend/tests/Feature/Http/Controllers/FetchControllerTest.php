<?php

use App\Models\ActivityLog;
use App\Models\Bill;
use App\Models\FetchBatch;
use App\Models\Property;
use App\Services\BillFetchService;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

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

describe('captcha fetch', function () {
    beforeEach(function () {
        config(['services.python_api.url' => 'http://python.test']);
        Http::preventStrayRequests();
        Storage::fake('local');
    });

    it('returns the captcha image for an iesco property', function () {
        $property = Property::factory()->create();
        Http::fake([
            'python.test/iesco/captcha/start' => Http::response([
                'challenge_id' => 'ch-1', 'reference_no' => $property->reference_no, 'image' => 'data:image/png;base64,AAA',
            ]),
        ]);

        $this->postJson('/api/fetch/captcha/start', ['property_id' => $property->id])
            ->assertOk()
            ->assertJson(['challenge_id' => 'ch-1', 'image' => 'data:image/png;base64,AAA', 'property_id' => $property->id]);

        Http::assertSent(fn ($request) => $request['reference_no'] === $property->reference_no);
    });

    it('rejects captcha fetching for non-iesco properties with 422', function () {
        $property = Property::factory()->create(['provider' => 'lesco']);

        $this->postJson('/api/fetch/captcha/start', ['property_id' => $property->id])
            ->assertUnprocessable();
    });

    it('returns 502 when the python api cannot reach iesco', function () {
        $property = Property::factory()->create();
        Http::fake(['python.test/iesco/captcha/start' => Http::response(['detail' => 'Could not reach IESCO: timeout'], 502)]);

        $this->postJson('/api/fetch/captcha/start', ['property_id' => $property->id])
            ->assertStatus(502)
            ->assertJson(['message' => 'Could not reach IESCO: timeout']);
    });

    it('stores the bill when the captcha answer is accepted', function () {
        $property = Property::factory()->create();
        Http::fake([
            'python.test/iesco/captcha/submit' => Http::response([
                'status' => 'success',
                'bill' => ['FETCH_STATUS' => 'SUCCESS', 'BILL_MONTH' => 'OCT 26', 'WEBSITE_PAYABLE_WITHIN_DUE_DATE' => 2100, '_RAW_HTML' => '<html></html>'],
            ]),
        ]);

        $this->postJson('/api/fetch/captcha/submit', ['property_id' => $property->id, 'challenge_id' => 'ch-1', 'answer' => 'ab12'])
            ->assertOk()
            ->assertJson(['status' => 'success', 'bill' => ['bill_month' => 'OCT 26']]);

        expect(Bill::sole()->property_id)->toBe($property->id)
            ->and(ActivityLog::sole()->status)->toBe('success');
    });

    it('does not duplicate a bill that already exists for the month', function () {
        $property = Property::factory()->create();
        app(BillFetchService::class)->storeFetchedBill($property, ['BILL_MONTH' => 'OCT 26'], 'iesco');
        Http::fake([
            'python.test/iesco/captcha/submit' => Http::response(['status' => 'success', 'bill' => ['BILL_MONTH' => 'OCT 26']]),
        ]);

        $this->postJson('/api/fetch/captcha/submit', ['property_id' => $property->id, 'challenge_id' => 'ch-1', 'answer' => 'ab12'])
            ->assertOk()
            ->assertJson(['status' => 'exists']);

        expect(Bill::count())->toBe(1);
    });

    it('reports a rejected captcha without storing anything', function () {
        $property = Property::factory()->create();
        Http::fake(['python.test/iesco/captcha/submit' => Http::response(['status' => 'captcha_invalid'])]);

        $this->postJson('/api/fetch/captcha/submit', ['property_id' => $property->id, 'challenge_id' => 'ch-1', 'answer' => 'nope'])
            ->assertOk()
            ->assertJson(['status' => 'captcha_invalid']);

        expect(Bill::count())->toBe(0);
    });

    it('reports an expired challenge', function () {
        $property = Property::factory()->create();
        Http::fake(['python.test/iesco/captcha/submit' => Http::response(['detail' => 'expired'], 410)]);

        $this->postJson('/api/fetch/captcha/submit', ['property_id' => $property->id, 'challenge_id' => 'ch-1', 'answer' => 'ab12'])
            ->assertOk()
            ->assertJson(['status' => 'expired']);
    });

    it('logs a failed fetch after an accepted captcha', function () {
        $property = Property::factory()->create();
        Http::fake(['python.test/iesco/captcha/submit' => Http::response(['status' => 'failed', 'error' => 'Reference mismatch'])]);

        $this->postJson('/api/fetch/captcha/submit', ['property_id' => $property->id, 'challenge_id' => 'ch-1', 'answer' => 'ab12'])
            ->assertOk()
            ->assertJson(['status' => 'failed', 'message' => 'Reference mismatch']);

        expect(ActivityLog::sole()->status)->toBe('failed');
    });
});
