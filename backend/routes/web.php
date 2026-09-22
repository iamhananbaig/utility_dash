<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/samples/{file}', function (string $file) {
    $allowed = [
        'property_import_sample.xlsx',
        'payment_upload_sample.xlsx',
        'bulk_ref_update_sample.xlsx',
        'location_import_sample.xlsx',
        'bills_import_sample.xlsx',
    ];

    if (! in_array($file, $allowed)) {
        abort(404);
    }

    $fullPath = public_path('samples/'.$file);

    if (! file_exists($fullPath)) {
        abort(404);
    }

    return response()->download($fullPath, $file, [
        'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]);
});
