<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bills', function (Blueprint $table) {
            $table->string('history_first_month')->nullable()->after('comparison_status');
            $table->decimal('history_first_kwh_units', 12, 2)->default(0)->after('history_first_month');
            $table->decimal('history_first_bill_rs', 12, 2)->default(0)->after('history_first_kwh_units');
            $table->string('history_last_month')->nullable()->after('history_first_bill_rs');
            $table->decimal('history_last_kwh_units', 12, 2)->default(0)->after('history_last_month');
            $table->decimal('history_last_bill_rs', 12, 2)->default(0)->after('history_last_kwh_units');
            $table->string('history_status')->nullable()->after('history_last_bill_rs');
            $table->string('website_payable_source')->nullable()->after('history_status');
            $table->string('returned_reference_no')->nullable()->after('website_payable_source');
            $table->string('reference_verification')->nullable()->after('returned_reference_no');
        });
    }

    public function down(): void
    {
        Schema::table('bills', function (Blueprint $table) {
            $table->dropColumn([
                'history_first_month', 'history_first_kwh_units', 'history_first_bill_rs',
                'history_last_month', 'history_last_kwh_units', 'history_last_bill_rs',
                'history_status', 'website_payable_source',
                'returned_reference_no', 'reference_verification',
            ]);
        });
    }
};
