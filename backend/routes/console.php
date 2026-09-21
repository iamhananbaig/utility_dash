<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Auto-fetch bills daily at 8:00 AM
Schedule::command('bills:fetch')->dailyAt('08:00');

// Auto-generate PDFs daily at 9:00 AM
Schedule::command('bills:generate-pdf')->dailyAt('09:00');
