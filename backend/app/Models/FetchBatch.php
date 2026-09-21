<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FetchBatch extends Model
{
    protected $fillable = [
        'total_refs',
        'completed',
        'success_count',
        'fail_count',
        'status',
        'started_at',
        'completed_at',
        'error_log',
    ];

    protected function casts(): array
    {
        return [
            'error_log' => 'array',
            'started_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    public function isComplete(): bool
    {
        return $this->completed >= $this->total_refs;
    }

    public function getProgressPercentage(): int
    {
        if ($this->total_refs === 0) {
            return 0;
        }

        return (int) round(($this->completed / $this->total_refs) * 100);
    }
}
