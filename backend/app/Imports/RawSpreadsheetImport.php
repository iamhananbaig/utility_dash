<?php

namespace App\Imports;

use Illuminate\Support\Collection;

class RawSpreadsheetImport
{
    public Collection $rows;

    public function load(string $filePath): void
    {
        $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));

        if ($ext === 'csv') {
            $this->loadCsv($filePath);
        } else {
            $this->loadXlsx($filePath);
        }
    }

    private function loadCsv(string $filePath): void
    {
        $handle = fopen($filePath, 'r');
        $rows = [];
        while (($data = fgetcsv($handle)) !== false) {
            $rows[] = collect($data);
        }
        fclose($handle);
        $this->rows = collect($rows);
    }

    private function loadXlsx(string $filePath): void
    {
        $zip = new \ZipArchive;
        if ($zip->open($filePath) !== true) {
            throw new \RuntimeException('Cannot open xlsx file');
        }

        $sharedStrings = $this->parseSharedStrings($zip);
        $sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
        $zip->close();

        if ($sheetXml === false) {
            throw new \RuntimeException('No sheet1.xml found in xlsx');
        }

        $xml = simplexml_load_string($sheetXml);
        $rows = [];

        foreach ($xml->sheetData->row as $row) {
            $cells = [];
            $lastCol = 0;
            foreach ($row->c as $cell) {
                $ref = (string) $cell['r'];
                preg_match('/^([A-Z]+)/', $ref, $m);
                $colIndex = $this->columnToIndex($m[1]);
                while ($lastCol < $colIndex) {
                    $cells[] = null;
                    $lastCol++;
                }
                $val = null;
                $cellType = isset($cell['t']) ? (string) $cell['t'] : '';

                if ($cellType === 's' && isset($sharedStrings[(int) (string) $cell->v])) {
                    $val = $sharedStrings[(int) (string) $cell->v];
                } elseif ($cellType === 'inlineStr' && isset($cell->is->t)) {
                    $val = (string) $cell->is->t;
                } elseif (isset($cell->v)) {
                    $val = (string) $cell->v;
                }
                $cells[] = $val;
                $lastCol++;
            }
            $rows[] = collect($cells);
        }

        $this->rows = collect($rows);
    }

    private function parseSharedStrings(\ZipArchive $zip): array
    {
        $strings = [];
        $xml = $zip->getFromName('xl/sharedStrings.xml');
        if ($xml === false) {
            return $strings;
        }
        $data = simplexml_load_string($xml);
        foreach ($data->si as $si) {
            $strings[] = (string) $si->t;
        }

        return $strings;
    }

    private function columnToIndex(string $column): int
    {
        $index = 0;
        for ($i = 0; $i < strlen($column); $i++) {
            $index = $index * 26 + (ord($column[$i]) - ord('A') + 1);
        }

        return $index - 1;
    }
}
