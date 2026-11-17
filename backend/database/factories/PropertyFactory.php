<?php

namespace Database\Factories;

use App\Models\Location;
use App\Models\Property;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Property>
 */
class PropertyFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->company(),
            'reference_no' => fake()->unique()->numerify('##############'),
            'provider' => 'iesco',
            'meter_no' => null,
            'location_id' => Location::factory(),
            'property_type' => 'branch',
            'status' => 'active',
            'notes' => null,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => ['status' => 'inactive']);
    }
}
