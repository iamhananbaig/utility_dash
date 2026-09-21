<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = ActivityLog::query();

        if ($request->has('type') && $request->type !== null) {
            $query->where('type', $request->type);
        }

        if ($request->has('status') && $request->status !== null) {
            $query->where('status', $request->status);
        }

        if ($request->has('from') && $request->from !== null) {
            $query->where('created_at', '>=', $request->from);
        }

        if ($request->has('to') && $request->to !== null) {
            $query->where('created_at', '<=', $request->to);
        }

        $logs = $query->orderByDesc('created_at')
            ->paginate($request->input('per_page', 50));

        return response()->json($logs);
    }
}
