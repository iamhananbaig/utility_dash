<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('properties', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('reference_no')->unique();
            $table->string('meter_no')->nullable();
            $table->foreignId('location_id')->constrained()->cascadeOnDelete();
            $table->enum('property_type', ['branch', 'hostel']);
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index('status');
            $table->index('location_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('properties');
    }
};
