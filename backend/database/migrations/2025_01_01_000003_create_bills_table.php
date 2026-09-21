<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bills', function (Blueprint $table) {
            $table->id();
            $table->foreignId('property_id')->constrained()->cascadeOnDelete();
            $table->string('provider')->default('iesco');
            $table->string('bill_month')->nullable();
            $table->string('issue_date')->nullable();
            $table->string('reading_date')->nullable();
            $table->string('due_date')->nullable();

            $table->decimal('arrears_amount', 12, 2)->default(0);
            $table->string('arrears_raw')->nullable();
            $table->decimal('energy_charges', 12, 2)->default(0);
            $table->decimal('taxes_total', 12, 2)->default(0);
            $table->decimal('fpa_taxes_total', 12, 2)->default(0);
            $table->decimal('calculated_payable', 12, 2)->default(0);
            $table->decimal('website_payable', 12, 2)->default(0);
            $table->decimal('payable_difference', 12, 2)->default(0);
            $table->string('comparison_status')->nullable();

            $table->enum('status', ['unpaid', 'paid', 'disputed', 'cancelled'])->default('unpaid');
            $table->timestamp('paid_at')->nullable();
            $table->decimal('paid_amount', 12, 2)->nullable();
            $table->text('payment_note')->nullable();

            $table->json('raw_data')->nullable();
            $table->string('raw_html_path')->nullable();
            $table->timestamp('fetched_at');
            $table->timestamps();

            $table->unique(['property_id', 'bill_month']);
            $table->index('status');
            $table->index('provider');
            $table->index('bill_month');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bills');
    }
};
