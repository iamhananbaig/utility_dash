<?php

namespace App\Traits;

trait HandlesSpreadsheetColumns
{
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
