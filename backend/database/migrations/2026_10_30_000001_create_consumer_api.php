<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('api_consumers', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('username', 80)->unique();
            $t->string('password');
            $t->text('integrations');
            $t->boolean('simulation')->default(false);
            $t->boolean('enabled')->default(true);
            $t->timestamps();
        });
        Schema::create('consumer_access_tokens', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('consumer_id')->constrained('api_consumers');
            $t->char('hash', 64)->unique();
            $t->timestamp('expires_at')->index();
            $t->timestamp('revoked_at')->nullable();
            $t->timestamp('created_at');
        });
        Schema::table('staging_records', function (Blueprint $t) {
            // UTC ISO text with seven fractional digits preserves datetime2(7).
            $t->string('worker_changed_at', 27)->nullable();
            $t->string('worker_time_zone', 64)->nullable();
            $t->index(['run_id', 'worker_changed_at', 'ordinal'], 'worker_window_lookup');
        });
    }

    public function down(): void
    {
        Schema::table('staging_records', function (Blueprint $t) {
            $t->dropIndex('worker_window_lookup');
            $t->dropColumn(['worker_changed_at', 'worker_time_zone']);
        });
        Schema::dropIfExists('consumer_access_tokens');
        Schema::dropIfExists('api_consumers');
    }
};
