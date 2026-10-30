<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('integrations', function (Blueprint $t) {
            $t->engine = 'InnoDB';
            $t->string('id', 80)->primary();
            $t->string('company');
            $t->string('mode')->default('ROLLING_WINDOW_CAPTURE');
            $t->boolean('enabled')->default(false);
            $t->boolean('publication_enabled')->default(false);
            $t->boolean('allow_empty')->default(false);
            $t->string('approved_company_code')->nullable();
            $t->unsignedInteger('max_rows')->default(1000000);
            $t->unsignedBigInteger('max_bytes')->default(536870912);
            $t->timestamps();
        });
        Schema::create('integration_schemas', function (Blueprint $t) {
            $t->id();
            $t->string('integration_id', 80);
            $t->foreign('integration_id')->references('id')->on('integrations');
            $t->string('version', 80);
            $t->char('hash', 64);
            $t->longText('document');
            $t->boolean('approved')->default(false);
            $t->boolean('simulation')->default(false);
            $t->unique(['integration_id', 'version']);
        });
        Schema::create('service_tokens', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->char('hash', 64)->unique();
            $t->string('origin', 100);
            $t->text('integrations');
            $t->text('scopes');
            $t->boolean('simulation')->default(false);
            $t->timestamp('expires_at');
            $t->timestamp('revoked_at')->nullable();
        });
        Schema::create('sync_runs', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('integration_id', 80);
            $t->foreign('integration_id')->references('id')->on('integrations');
            $t->foreignId('schema_id')->constrained('integration_schemas');
            $t->string('origin', 100);
            $t->boolean('simulation');
            $t->string('mode');
            $t->string('status')->default('receiving');
            $t->char('manifest_hash', 64);
            $t->longText('manifest');
            $t->unsignedBigInteger('expected_rows');
            $t->unsignedBigInteger('expected_bytes');
            $t->unsignedInteger('expected_batches');
            $t->timestamp('source_started_at');
            $t->timestamp('source_completed_at');
            $t->timestamps();
            $t->index(['integration_id', 'created_at']);
        });
        Schema::create('sync_partitions', function (Blueprint $t) {
            // Expected immutable batch descriptors, independent from received batches.
            $t->id();
            $t->foreignUuid('run_id')->constrained('sync_runs');
            $t->unsignedInteger('number');
            $t->unsignedBigInteger('first_ordinal');
            $t->unsignedInteger('row_count');
            $t->unsignedInteger('byte_count');
            $t->char('hash', 64);
            $t->unique(['run_id', 'number']);
        });
        Schema::create('sync_batches', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('run_id')->constrained('sync_runs');
            $t->unsignedInteger('number');
            $t->char('hash', 64);
            $t->unsignedInteger('row_count');
            $t->unsignedInteger('byte_count');
            $t->timestamp('received_at');
            $t->unique(['run_id', 'number']);
        });
        Schema::create('staging_records', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('run_id')->constrained('sync_runs');
            $t->unsignedBigInteger('ordinal');
            $t->unsignedInteger('batch_number');
            $t->longText('payload'); // Laravel authenticated encryption; no PII in indexes.
            $t->char('hash', 64);
            $t->unique(['run_id', 'ordinal']);
        });
        Schema::create('publications', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('integration_id', 80);
            $t->foreign('integration_id')->references('id')->on('integrations');
            $t->foreignUuid('run_id')->unique()->constrained('sync_runs');
            $t->unsignedBigInteger('row_count');
            $t->timestamp('created_at');
        });
        Schema::create('published_records', function (Blueprint $t) {
            $t->id();
            $t->foreignUuid('publication_id')->constrained('publications');
            $t->foreignId('staging_record_id')->constrained('staging_records');
            $t->unsignedBigInteger('ordinal');
            $t->unique(['publication_id', 'ordinal']);
        });
        Schema::create('active_publications', function (Blueprint $t) {
            $t->string('integration_id', 80)->primary();
            $t->foreign('integration_id')->references('id')->on('integrations');
            $t->foreignUuid('publication_id')->constrained('publications');
            $t->timestamp('updated_at');
        });
        Schema::create('audit_events', function (Blueprint $t) {
            $t->id();
            $t->string('action', 80);
            $t->string('integration_id', 80)->nullable();
            $t->uuid('run_id')->nullable();
            $t->uuid('token_id')->nullable();
            $t->string('correlation_id', 100)->nullable();
            $t->text('details')->nullable(); // Counts / publication IDs only.
            $t->timestamp('created_at');
        });
    }

    public function down(): void
    {
        foreach (['audit_events', 'active_publications', 'published_records', 'publications', 'staging_records', 'sync_batches', 'sync_partitions', 'sync_runs', 'service_tokens', 'integration_schemas', 'integrations'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
