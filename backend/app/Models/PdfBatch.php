<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PdfBatch extends Model
{
    protected $fillable = [
        'status',
        'bill_count',
        'pdf_path',
        'error',
    ];
}
