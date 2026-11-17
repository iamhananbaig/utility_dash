<?php

namespace App\Http\Controllers;

use App\Exports\BillsExport;
use App\Models\ActivityLog;
use App\Models\Bill;
use App\Models\FetchBatch;
use App\Models\Property;
use App\Services\BillFetchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Http;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class FetchController extends Controller
{
    public function __construct(
        private BillFetchService $fetchService,
    ) {}

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'location_id' => 'nullable|exists:locations,id',
            'property_type' => 'nullable|in:branch,hostel',
            'provider' => 'nullable|string|max:255',
        ]);

        $batch = $this->fetchService->startBatch(
            $validated['location_id'] ?? null,
            $validated['property_type'] ?? null,
            $validated['provider'] ?? null,
        );

        return response()->json([
            'batch_id' => $batch->id,
            'total_refs' => $batch->total_refs,
        ], 201);
    }

    public function storeSingle(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'reference_no' => 'required|string|max:255',
            'provider' => 'nullable|string|max:255',
        ]);

        $batch = $this->fetchService->startSingle(
            $validated['reference_no'],
            $validated['provider'] ?? 'iesco',
        );

        return response()->json([
            'batch_id' => $batch->id,
            'total_refs' => 1,
        ], 201);
    }

    /**
     * Open an IESCO CAPTCHA challenge for a property; a person reads the image.
     */
    public function captchaStart(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'property_id' => 'required|integer|exists:properties,id',
        ]);

        $property = Property::findOrFail($validated['property_id']);

        if ($property->provider !== 'iesco') {
            return response()->json(['message' => 'CAPTCHA fetching is only available for IESCO properties.'], 422);
        }

        $response = Http::connectTimeout(5)->timeout(60)
            ->post(config('services.python_api.url').'/iesco/captcha/start', [
                'reference_no' => $property->reference_no,
            ]);

        if (! $response->successful()) {
            return response()->json([
                'message' => $response->json('detail') ?? 'Could not load a CAPTCHA from IESCO.',
            ], $response->status() === 422 ? 422 : 502);
        }

        return response()->json([
            'property_id' => $property->id,
            'reference_no' => $property->reference_no,
            'challenge_id' => $response->json('challenge_id'),
            'image' => $response->json('image'),
        ]);
    }

    /**
     * Submit the CAPTCHA a person typed and store the fetched bill.
     */
    public function captchaSubmit(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'property_id' => 'required|integer|exists:properties,id',
            'challenge_id' => 'required|string|max:64',
            'answer' => 'required|string|max:10',
        ]);

        $property = Property::findOrFail($validated['property_id']);

        $response = Http::connectTimeout(5)->timeout(90)
            ->post(config('services.python_api.url').'/iesco/captcha/submit', [
                'challenge_id' => $validated['challenge_id'],
                'answer' => $validated['answer'],
            ]);

        if ($response->status() === 410) {
            return response()->json(['status' => 'expired', 'message' => 'This CAPTCHA expired. Load a new one.']);
        }

        if (! $response->successful()) {
            return response()->json(['message' => 'The Python API could not complete the request.'], 502);
        }

        $status = $response->json('status');

        if ($status === 'captcha_invalid') {
            return response()->json(['status' => 'captcha_invalid', 'message' => 'IESCO did not accept that code. Try the new one.']);
        }

        if ($status !== 'success') {
            $error = $response->json('error') ?? 'Unknown error';

            ActivityLog::create([
                'type' => 'fetch',
                'status' => 'failed',
                'message' => "CAPTCHA fetch failed for {$property->reference_no}: {$error}",
                'details' => ['property_id' => $property->id, 'reference_no' => $property->reference_no, 'error' => $error],
            ]);

            return response()->json(['status' => 'failed', 'message' => $error]);
        }

        $bill = $this->fetchService->storeFetchedBill($property, $response->json('bill'), 'iesco');

        ActivityLog::create([
            'type' => 'fetch',
            'status' => 'success',
            'message' => $bill->wasRecentlyCreated
                ? "Bill fetched with CAPTCHA for {$property->reference_no} ({$bill->bill_month})"
                : "Bill for {$property->reference_no} ({$bill->bill_month}) already existed",
            'details' => ['property_id' => $property->id, 'reference_no' => $property->reference_no, 'bill_id' => $bill->id],
        ]);

        return response()->json([
            'status' => $bill->wasRecentlyCreated ? 'success' : 'exists',
            'bill' => $bill->load('property.location'),
        ]);
    }

    public function latest(): JsonResponse|Response
    {
        $batch = FetchBatch::latest()->first();

        // response()->json(null) would serialize as "{}", which clients read as a batch.
        if (! $batch) {
            return response()->noContent();
        }

        return response()->json([
            'batch_id' => $batch->id,
            'status' => $batch->status,
            'total_refs' => $batch->total_refs,
            'completed' => $batch->completed,
            'success_count' => $batch->success_count,
            'fail_count' => $batch->fail_count,
            'progress' => $batch->getProgressPercentage(),
        ]);
    }

    public function status(int $id): JsonResponse
    {
        $batch = FetchBatch::findOrFail($id);

        return response()->json([
            'batch_id' => $batch->id,
            'status' => $batch->status,
            'total_refs' => $batch->total_refs,
            'completed' => $batch->completed,
            'success_count' => $batch->success_count,
            'fail_count' => $batch->fail_count,
            'progress' => $batch->getProgressPercentage(),
        ]);
    }

    public function results(int $id): JsonResponse
    {
        $batch = FetchBatch::findOrFail($id);

        if ($batch->status !== 'completed') {
            return response()->json(['message' => 'Batch not yet completed'], 422);
        }

        $bills = Bill::with('property.location')
            ->where('fetched_at', '>=', $batch->started_at)
            ->orderByDesc('bill_month')
            ->get();

        return response()->json($bills);
    }

    public function download(int $id): BinaryFileResponse
    {
        $batch = FetchBatch::findOrFail($id);

        $bills = Bill::with('property.location')
            ->where('fetched_at', '>=', $batch->started_at)
            ->orderByDesc('bill_month')
            ->get();

        return Excel::download(
            new BillsExport($bills),
            "bills_batch_{$id}.xlsx"
        );
    }
}
