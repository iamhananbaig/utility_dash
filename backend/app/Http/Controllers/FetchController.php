<?php

namespace App\Http\Controllers;

use App\Exports\BillsExport;
use App\Models\Bill;
use App\Models\FetchBatch;
use App\Services\BillFetchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

    public function latest(): JsonResponse
    {
        $batch = FetchBatch::latest()->first();

        if (! $batch) {
            return response()->json(null);
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
