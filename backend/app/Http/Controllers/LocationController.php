<?php

namespace App\Http\Controllers;

use App\Models\Location;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
            'name' => 'required|string|max:255',
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
            'name' => 'required|string|max:255',
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
}
