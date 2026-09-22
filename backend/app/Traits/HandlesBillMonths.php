<?php

namespace App\Traits;

use Carbon\Carbon;

trait HandlesBillMonths
{
    private function parseBillMonth(string $billMonth): ?Carbon
    {
        try {
            return Carbon::createFromFormat('M y', $billMonth);
        } catch (\Throwable) {
            try {
                return Carbon::createFromFormat('M Y', $billMonth);
            } catch (\Throwable) {
                try {
                    return Carbon::parse($billMonth);
                } catch (\Throwable) {
                    return null;
                }
            }
        }
    }
}
