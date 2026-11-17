<?php

namespace Database\Factories;

use App\Models\FetchBatch;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<FetchBatch>
 */
class FetchBatchFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'total_refs' => 1,
            'completed' => 0,
            'success_count' => 0,
            'fail_count' => 0,
            'status' => 'running',
            'started_at' => now(),
        ];
    }
}
