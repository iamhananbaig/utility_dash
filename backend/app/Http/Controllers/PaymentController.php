<?php

namespace App\Http\Controllers;

use App\Models\PaymentProof;
use App\Services\PaymentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PaymentController extends Controller
{
    public function __construct(
        private PaymentService $paymentService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $payments = PaymentProof::with('bill.property')
            ->orderByDesc('created_at')
            ->paginate($request->input('per_page', 50));

        return response()->json($payments);
    }

    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:xlsx,xls,csv|max:10240',
        ]);

        $result = $this->paymentService->processExcelUpload($request->file('file'));

        return response()->json([
            'message' => "Matched: {$result['matched']}, Not found: {$result['not_found']}",
            'matched' => $result['matched'],
            'not_found' => $result['not_found'],
            'errors' => $result['errors'],
        ]);
    }

    public function downloadFile(int $id): StreamedResponse
    {
        $proof = PaymentProof::findOrFail($id);

        return Storage::disk('local')->download($proof->file_path, $proof->original_name);
    }
}
