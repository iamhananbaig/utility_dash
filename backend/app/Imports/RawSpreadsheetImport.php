<?php

namespace App\Imports;

use Illuminate\Support\Collection;
use Maatwebsite\Excel\Concerns\ToCollection;

class RawSpreadsheetImport implements ToCollection
{
    public Collection $rows;

    public function collection(Collection $rows): void
    {
        $this->rows = $rows;
    }
}
