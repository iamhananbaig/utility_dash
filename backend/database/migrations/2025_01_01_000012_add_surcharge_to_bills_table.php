<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bills', function (Blueprint $table) {
            $table->decimal('surcharge', 12, 2)->default(0)->after('advance_tax');
            $table->decimal('payable_after_due_date', 12, 2)->default(0)->after('surcharge');
        });
    }

    public function down(): void
    {
        Schema::table('bills', function (Blueprint $table) {
            $table->dropColumn(['surcharge', 'payable_after_due_date']);
        });
    }
};
