<?php

use App\Http\Controllers\BillController;
use App\Http\Controllers\ComparativeController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\FetchController;
use App\Http\Controllers\LocationController;
use App\Http\Controllers\LocationTrendController;
use App\Http\Controllers\LogController;
use App\Http\Controllers\PaymentController;
use App\Http\Controllers\PropertyController;
use Illuminate\Support\Facades\Route;

Route::get('/dashboard', [DashboardController::class, 'index']);

Route::post('locations/import', [LocationController::class, 'import']);
Route::apiResource('locations', LocationController::class);

Route::post('properties/import', [PropertyController::class, 'import']);
Route::post('properties/bulk-update-ref', [PropertyController::class, 'bulkUpdateReference']);
Route::get('properties/{id}/bills', [PropertyController::class, 'bills']);
Route::get('properties/{id}/history', [PropertyController::class, 'history']);
Route::apiResource('properties', PropertyController::class);

Route::post('fetch', [FetchController::class, 'store']);
Route::get('fetch/latest', [FetchController::class, 'latest']);
Route::get('fetch/{id}/status', [FetchController::class, 'status']);
Route::get('fetch/{id}/results', [FetchController::class, 'results']);
Route::get('fetch/{id}/download', [FetchController::class, 'download']);

Route::get('bills', [BillController::class, 'index']);
Route::get('bills/export', [BillController::class, 'export']);
Route::post('bills/bulk-process', [BillController::class, 'bulkProcess']);
Route::post('bills/manual-payment', [BillController::class, 'manualPayment']);
Route::patch('bills/{id}/process', [BillController::class, 'process']);
Route::patch('bills/{id}/pay', [BillController::class, 'markPaid']);
Route::patch('bills/{id}/pay-details', [BillController::class, 'markPaidWithDetails']);
Route::post('bills/bulk-mark-paid', [BillController::class, 'bulkMarkPaid']);
Route::patch('bills/{id}/status', [BillController::class, 'updateStatus']);
Route::patch('bills/{id}/amount', [BillController::class, 'updateAmount']);
Route::get('bills/{id}/html', [BillController::class, 'showHtml']);
Route::get('bills/{id}/pdf', [BillController::class, 'pdf']);
Route::post('bills/bulk-pdf', [BillController::class, 'bulkPdf']);
Route::post('bills/generate-pdf', [BillController::class, 'generatePdf']);
Route::get('bills/pdf-status', [BillController::class, 'pdfStatus']);

Route::get('payments', [PaymentController::class, 'index']);
Route::post('payments/upload', [PaymentController::class, 'upload']);
Route::get('payments/{id}/file', [PaymentController::class, 'downloadFile']);

Route::post('comparative', [ComparativeController::class, 'analyze']);

Route::get('locations/{id}/trend', [LocationTrendController::class, 'trend']);

Route::get('logs', [LogController::class, 'index']);
