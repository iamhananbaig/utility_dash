<?php

namespace App\Http\Controllers;

use App\Imports\RawSpreadsheetImport;
use App\Models\Location;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Maatwebsite\Excel\Facades\Excel;

class LocationController extends Controller
{
    public function index(): JsonResponse
    {
        $locations = Location::withCount('properties')->orderBy('code')->get();

        return response()->json($locations);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => 'required|string|max:255|unique:locations,code',
            'city' => 'required|string|max:255',
        ]);

        $location = Location::create($validated);

        return response()->json($location, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $location = Location::findOrFail($id);

        $validated = $request->validate([
            'code' => 'required|string|max:255|unique:locations,code,'.$location->id,
            'city' => 'required|string|max:255',
        ]);

        $location->update($validated);

        return response()->json($location);
    }

    public function destroy(int $id): JsonResponse
    {
        $location = Location::findOrFail($id);
        $location->delete();

        return response()->json(['message' => 'Location deleted']);
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
        Excel::import($import, $fullPath);
        $spreadsheet = $import->rows;

        if ($spreadsheet === null || $spreadsheet->isEmpty()) {
            return response()->json(['message' => 'Empty file'], 422);
        }

        $headers = $spreadsheet->first();

        if ($headers instanceof Collection) {
            $headers = $headers->toArray();
        }

        $rows = $spreadsheet->slice(1);

        $codeIndex = $this->findColumnIndex($headers, ['code', 'location_code', 'location']);
        $cityIndex = $this->findColumnIndex($headers, ['city']);

        if ($codeIndex === null) {
            return response()->json(['message' => 'Required column not found: code'], 422);
        }

        $imported = 0;
        $skipped = 0;

        DB::transaction(function () use ($rows, $codeIndex, $cityIndex, &$imported, &$skipped) {
            foreach ($rows as $row) {
                $code = trim((string) ($row[$codeIndex] ?? ''));

                if ($code === '') {
                    $skipped++;

                    continue;
                }

                if (Location::where('code', $code)->exists()) {
                    $skipped++;

                    continue;
                }

                $city = $cityIndex !== null ? trim((string) ($row[$cityIndex] ?? '')) : '';

                Location::create([
                    'code' => $code,
                    'city' => $city ?: 'Unknown',
                ]);

                $imported++;
            }
        });

        return response()->json([
            'message' => "Imported {$imported} locations, skipped {$skipped}",
            'imported' => $imported,
            'skipped' => $skipped,
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
