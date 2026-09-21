<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bills', function (Blueprint $table) {
            $table->string('instruction_id')->nullable()->after('payment_note');
            $table->string('batch_no')->nullable()->after('instruction_id');
            $table->string('voucher_no')->nullable()->after('batch_no');
            $table->date('payment_date')->nullable()->after('voucher_no');
        });

        DB::statement("ALTER TABLE bills MODIFY COLUMN status ENUM('unpaid', 'in_process', 'paid', 'disputed', 'cancelled') DEFAULT 'unpaid'");
    }

    public function down(): void
    {
        Schema::table('bills', function (Blueprint $table) {
            $table->dropColumn(['instruction_id', 'batch_no', 'voucher_no', 'payment_date']);
        });

        DB::statement("ALTER TABLE bills MODIFY COLUMN status ENUM('unpaid', 'paid', 'disputed', 'cancelled') DEFAULT 'unpaid'");
    }
};
