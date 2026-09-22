<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/samples/{file}', function (string $file) {
    $allowed = [
        'property_import_sample.xlsx',
        'payment_upload_sample.xlsx',
        'bulk_ref_update_sample.xlsx',
        'location_import_sample.xlsx',
    ];

    if (! in_array($file, $allowed)) {
        abort(404);
    }

    $path = 'samples/'.$file;

    if (! Storage::disk('public')->exists($path)) {
        abort(404);
    }

    return Storage::disk('public')->download($path, $file);
})->where('file', '.*');
