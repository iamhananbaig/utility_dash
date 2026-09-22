<?php

namespace App\Http\Controllers;

use App\Imports\RawSpreadsheetImport;
use App\Models\Location;
use App\Models\Property;
use App\Models\ReferenceHistory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class PropertyController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Property::with('location');

        if ($request->has('location_id') && $request->location_id !== null) {
            $query->where('location_id', $request->location_id);
        }

        if ($request->has('status') && $request->status !== null) {
            $query->where('status', $request->status);
        }

        if ($request->has('property_type') && $request->property_type !== null) {
            $query->where('property_type', $request->property_type);
        }

        if ($request->has('provider') && $request->provider !== null) {
            $query->where('provider', $request->provider);
        }

        if ($request->has('search') && $request->search !== null) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('reference_no', 'like', "%{$search}%")
                    ->orWhere('meter_no', 'like', "%{$search}%")
                    ->orWhere('provider', 'like', "%{$search}%");
            });
        }

        $properties = $query->orderBy('name')->get();

        return response()->json($properties);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'reference_no' => 'required|string|max:255|unique:properties,reference_no',
            'provider' => 'required|string|max:255',
            'meter_no' => 'nullable|string|max:255',
            'location_id' => 'required|exists:locations,id',
            'property_type' => 'required|in:branch,hostel',
            'status' => 'nullable|in:active,inactive',
            'notes' => 'nullable|string',
        ]);

        $property = Property::create($validated);

        return response()->json($property->load('location'), 201);
    }

    public function show(int $id): JsonResponse
    {
        $property = Property::with('location')->findOrFail($id);

        return response()->json($property);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $property = Property::findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'reference_no' => 'required|string|max:255|unique:properties,reference_no,'.$property->id,
            'provider' => 'required|string|max:255',
            'meter_no' => 'nullable|string|max:255',
            'location_id' => 'required|exists:locations,id',
            'property_type' => 'required|in:branch,hostel',
            'status' => 'nullable|in:active,inactive',
            'notes' => 'nullable|string',
        ]);

        if ($property->reference_no !== $validated['reference_no']) {
            ReferenceHistory::create([
                'property_id' => $property->id,
                'old_reference_no' => $property->reference_no,
                'new_reference_no' => $validated['reference_no'],
                'reason' => $request->input('reference_change_reason'),
                'changed_at' => now(),
            ]);
        }

        $property->update($validated);

        return response()->json($property->load('location'));
    }

    public function destroy(int $id): JsonResponse
    {
        $property = Property::findOrFail($id);
        $property->delete();

        return response()->json(['message' => 'Property deleted']);
    }

    public function import(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240',
        ]);

        $file = $request->file('file');
        $path = $file->store('imports', 'local');
        $fullPath = Storage::disk('local')->path($path);

        $import = new RawSpreadsheetImport;
        $import->load($fullPath);
        $spreadsheet = $import->rows;

        if ($spreadsheet === null || $spreadsheet->isEmpty()) {
            return response()->json(['message' => 'Empty file'], 422);
        }

        $headers = $spreadsheet->first();

        if ($headers instanceof Collection) {
            $headers = $headers->toArray();
        }

        $rows = $spreadsheet->slice(1);

        $nameIndex = $this->findColumnIndex($headers, ['name', 'property_name']);
        $refIndex = $this->findColumnIndex($headers, ['reference_no', 'ref_no', 'refno']);
        $providerIndex = $this->findColumnIndex($headers, ['provider']);
        $meterIndex = $this->findColumnIndex($headers, ['meter_no', 'meter', 'meter_number']);
        $locationIndex = $this->findColumnIndex($headers, ['location', 'location_code', 'code']);
        $typeIndex = $this->findColumnIndex($headers, ['property_type', 'type']);

        if ($refIndex === null || $nameIndex === null) {
            return response()->json(['message' => 'Required columns not found: name, reference_no'], 422);
        }

        $imported = 0;
        $skipped = 0;
        $errors = [];

        DB::transaction(function () use ($rows, $nameIndex, $refIndex, $providerIndex, $meterIndex, $locationIndex, $typeIndex, &$imported, &$skipped, &$errors) {
            foreach ($rows as $row) {
                $name = trim((string) ($row[$nameIndex] ?? ''));
                $refNo = trim((string) ($row[$refIndex] ?? ''));

                if ($name === '' || $refNo === '') {
                    $skipped++;

                    continue;
                }

                if (Property::where('reference_no', $refNo)->exists()) {
                    $skipped++;

                    continue;
                }

                $locationId = null;
                if ($locationIndex !== null) {
                    $locationCode = trim((string) ($row[$locationIndex] ?? ''));
                    if ($locationCode !== '') {
                        $location = Location::where('code', $locationCode)->first();
                        if ($location) {
                            $locationId = $location->id;
                        }
                    }
                }

                if ($locationId === null) {
                    $skipped++;
                    $errors[] = "{$refNo}: location not found";

                    continue;
                }

                $propertyType = 'branch';
                if ($typeIndex !== null) {
                    $type = strtolower(trim((string) ($row[$typeIndex] ?? '')));
                    if (in_array($type, ['branch', 'hostel'])) {
                        $propertyType = $type;
                    }
                }

                $provider = 'iesco';
                if ($providerIndex !== null) {
                    $providerValue = strtolower(trim((string) ($row[$providerIndex] ?? '')));
                    if ($providerValue !== '') {
                        $provider = $providerValue;
                    }
                }

                Property::create([
                    'name' => $name,
                    'reference_no' => $refNo,
                    'provider' => $provider,
                    'meter_no' => $meterIndex !== null ? trim((string) ($row[$meterIndex] ?? '')) : null,
                    'location_id' => $locationId,
                    'property_type' => $propertyType,
                    'status' => 'active',
                ]);

                $imported++;
            }
        });

        return response()->json([
            'message' => "Imported {$imported} properties, skipped {$skipped}",
            'imported' => $imported,
            'skipped' => $skipped,
            'errors' => $errors,
        ]);
    }

    public function bills(int $id): JsonResponse
    {
        $property = Property::findOrFail($id);
        $bills = $property->bills()->orderByDesc('bill_month')->get();

        return response()->json($bills);
    }

    public function history(int $id): JsonResponse
    {
        $property = Property::findOrFail($id);
        $history = $property->referenceHistories()->orderByDesc('changed_at')->get();

        return response()->json($history);
    }

    public function bulkUpdateReference(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240',
        ]);

        $file = $request->file('file');
        $path = $file->store('imports', 'local');
        $fullPath = Storage::disk('local')->path($path);

        $import = new RawSpreadsheetImport;
        $import->load($fullPath);
        $spreadsheet = $import->rows;

        if ($spreadsheet === null || $spreadsheet->isEmpty()) {
            return response()->json(['message' => 'Empty file'], 422);
        }

        $headers = $spreadsheet->first();

        if ($headers instanceof Collection) {
            $headers = $headers->toArray();
        }

        $rows = $spreadsheet->slice(1);

        $oldRefIndex = $this->findColumnIndex($headers, ['old_reference_no', 'old_ref', 'old_refno', 'previous_ref']);
        $newRefIndex = $this->findColumnIndex($headers, ['new_reference_no', 'new_ref', 'new_refno', 'reference_no']);

        if ($oldRefIndex === null || $newRefIndex === null) {
            return response()->json(['message' => 'Required columns not found: old_reference_no, new_reference_no'], 422);
        }

        $updated = 0;
        $notFound = 0;
        $skipped = 0;
        $errors = [];

        DB::transaction(function () use ($rows, $oldRefIndex, $newRefIndex, &$updated, &$notFound, &$skipped, &$errors) {
            foreach ($rows as $row) {
                $oldRef = trim((string) ($row[$oldRefIndex] ?? ''));
                $newRef = trim((string) ($row[$newRefIndex] ?? ''));

                if ($oldRef === '' || $newRef === '') {
                    $skipped++;

                    continue;
                }

                if ($oldRef === $newRef) {
                    $skipped++;

                    continue;
                }

                $property = Property::where('reference_no', $oldRef)->first();

                if (! $property) {
                    $notFound++;

                    continue;
                }

                // Check if new ref already exists on another property
                $existing = Property::where('reference_no', $newRef)
                    ->where('id', '!=', $property->id)
                    ->first();

                if ($existing) {
                    $errors[] = "New ref {$newRef} already exists on property {$existing->name} (ID: {$existing->id})";
                    $skipped++;

                    continue;
                }

                // Create history record
                ReferenceHistory::create([
                    'property_id' => $property->id,
                    'old_reference_no' => $oldRef,
                    'new_reference_no' => $newRef,
                    'reason' => 'Bulk update via Excel',
                    'changed_at' => now(),
                ]);

                // Update property
                $property->update(['reference_no' => $newRef]);
                $updated++;
            }
        });

        return response()->json([
            'message' => "Updated: {$updated}, Not found: {$notFound}, Skipped: {$skipped}",
            'updated' => $updated,
            'not_found' => $notFound,
            'skipped' => $skipped,
            'errors' => $errors,
        ]);
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
