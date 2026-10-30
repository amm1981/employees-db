<?php

namespace Tests\Feature;

use App\Sync\Canonical;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class SyncTest extends TestCase
{
    use RefreshDatabase;

    private array $schema;

    private array $rows;

    private array $headers;

    private string $dataset = 'casablanca-altas-bajas';

    protected function setUp(): void
    {
        parent::setUp();
        config(['sync.allow_fixtures' => true]);
        $this->schema = json_decode(file_get_contents(base_path('../tests/fixtures/schema.json')), true);
        $this->rows = json_decode(file_get_contents(base_path('../tests/fixtures/rows.json')), true);
        $secrets = ['ingestToken' => str_repeat('a', 48), 'readToken' => str_repeat('b', 48), 'opsToken' => str_repeat('c', 48)];
        $file = tempnam(sys_get_temp_dir(), 'get-employes-test-');
        file_put_contents($file, json_encode($secrets));
        try {
            $this->artisan('fixtures:setup', ['--secrets-file' => $file])->assertExitCode(0);
        } finally {
            unlink($file);
        }
        $this->headers = ['Authorization' => 'Bearer '.$secrets['ingestToken'], 'X-Agent-Origin' => 'fixture-agent'];
    }

    private function manifest(?array $rows = null, ?string $id = null): array
    {
        $rows = $rows ?? $this->rows;

        return ['protocol' => 1, 'runId' => $id ?? (string) Str::uuid(), 'integrationId' => $this->dataset, 'dataset' => $this->dataset, 'origin' => 'fixture-agent', 'simulation' => true, 'mode' => 'ROLLING_WINDOW_CAPTURE', 'schema' => $this->schema, 'schemaHash' => Canonical::hash($this->schema), 'startedAt' => '2026-10-26T01:00:00.000Z', 'completedAt' => '2026-10-26T01:00:01.000Z', 'totalRows' => count($rows), 'totalBytes' => $rows ? strlen(Canonical::encode($rows)) : 0, 'batches' => $rows ? [['number' => 0, 'first' => 0, 'count' => count($rows), 'bytes' => strlen(Canonical::encode($rows)), 'hash' => Canonical::hash($rows)]] : []];
    }

    private function url(array $m, string $suffix = ''): string
    {
        return '/api/v1/sync/runs/'.$m['runId'].$suffix;
    }

    private function batchBody(array $rows): array
    {
        return ['hash' => Canonical::hash($rows), 'first' => 0, 'count' => count($rows), 'rows' => $rows];
    }

    private function uploaded(?array $rows = null): array
    {
        $rows = $rows ?? $this->rows;
        $m = $this->manifest($rows);
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertCreated();
        $this->putJson($this->url($m, '/batches/0'), $this->batchBody($rows), $this->headers)->assertOk();

        return $m;
    }

    private function published(?array $rows = null): array
    {
        $m = $this->uploaded($rows);
        $this->postJson($this->url($m, '/finalize'), [], $this->headers)->assertOk();
        $m['publicationId'] = $this->postJson($this->url($m, '/publish'), [], $this->headers)->assertOk()->json('publicationId');

        return $m;
    }

    private function readHeaders(): array
    {
        return ['Authorization' => 'Bearer '.str_repeat('b', 48)];
    }

    public function test_authentication_and_permissions_are_separate(): void
    {
        $this->getJson('/api/v1/datasets')->assertUnauthorized();
        $this->getJson('/api/v1/datasets', $this->headers)->assertForbidden();
        $this->postJson('/api/v1/sync/runs', $this->manifest(), $this->readHeaders())->assertForbidden();
        $this->getJson('/api/v1/datasets', $this->readHeaders())->assertOk()->assertJsonPath('datasets.0.exhaustive', false);
    }

    public function test_origin_and_dataset_scope_are_enforced(): void
    {
        $h = $this->headers;
        $h['X-Agent-Origin'] = 'wrong';
        $this->postJson('/api/v1/sync/runs', $this->manifest(), $h)->assertForbidden();
        DB::table('service_tokens')->where('hash', hash('sha256', str_repeat('a', 48)))->update(['integrations' => '[]']);
        $this->postJson('/api/v1/sync/runs', $this->manifest(), $this->headers)->assertForbidden();
    }

    public function test_expired_and_revoked_tokens_are_rejected(): void
    {
        DB::table('service_tokens')->update(['expires_at' => now()->subMinute()]);
        $this->getJson('/api/v1/datasets', $this->readHeaders())->assertUnauthorized();
        DB::table('service_tokens')->update(['expires_at' => now()->addDay(), 'revoked_at' => now()]);
        $this->getJson('/api/v1/datasets', $this->readHeaders())->assertUnauthorized();
    }

    public function test_complete_flow_preserves_values_duplicates_and_encryption(): void
    {
        $m = $this->published();
        $raw = DB::table('staging_records')->value('payload');
        $this->assertStringNotContainsString('Ficticio', $raw);
        $resp = $this->getJson('/api/v1/datasets/'.$this->dataset.'/records', $this->readHeaders())->assertOk()->assertJsonPath('exhaustive', false)->assertJsonPath('total', 3)->assertJsonPath('publicationId', $m['publicationId']);
        $this->assertSame($this->rows, array_column($resp->json('records'), 'values'));
        $this->assertSame('', $resp->json('records.0.values.4'));
        $this->assertNull($resp->json('records.0.values.1'));
    }

    public function test_idempotent_run_and_batch_replay(): void
    {
        $m = $this->uploaded();
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertOk();
        $this->putJson($this->url($m, '/batches/0'), $this->batchBody($this->rows), $this->headers)->assertOk();
        $this->assertDatabaseCount('staging_records', 3);
        $this->assertDatabaseCount('sync_batches', 1);
        $m['totalRows'] = 4;
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertConflict();
    }

    public function test_duplicate_batch_with_different_content_is_conflict(): void
    {
        $m = $this->uploaded();
        $changed = $this->rows;
        $changed[0][2] = '0099';
        $this->putJson($this->url($m, '/batches/0'), $this->batchBody($changed), $this->headers)->assertConflict();
        $body = $this->batchBody($this->rows);
        $body['rows'][0][2] = '0088';
        $this->putJson($this->url($m, '/batches/0'), $body, $this->headers)->assertConflict();
    }

    public function test_hash_schema_and_ordinal_changes_are_rejected(): void
    {
        $m = $this->manifest();
        $m['schema']['columns'][0]['sqlType'] = 'varchar';
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertUnprocessable();
        $m = $this->manifest();
        $m['schemaHash'] = str_repeat('0', 64);
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertUnprocessable();
        $m = $this->manifest();
        $m['batches'][0]['first'] = 1;
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertUnprocessable();
        $m = $this->manifest();
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertCreated();
        $b = $this->batchBody($this->rows);
        $b['hash'] = str_repeat('0', 64);
        $this->putJson($this->url($m, '/batches/0'), $b, $this->headers)->assertUnprocessable();
    }

    public function test_empty_capture_requires_explicit_integration_approval(): void
    {
        $m = $this->manifest([]);
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertUnprocessable();
        DB::table('integrations')->where('id', $this->dataset)->update(['allow_empty' => true]);
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertCreated();
        $this->postJson($this->url($m, '/finalize'), [], $this->headers)->assertOk();
    }

    public function test_missing_batches_or_unfinalized_run_never_publish(): void
    {
        $m = $this->manifest();
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertCreated();
        $this->postJson($this->url($m, '/finalize'), [], $this->headers)->assertConflict();
        $this->postJson($this->url($m, '/publish'), [], $this->headers)->assertConflict();
        $this->assertDatabaseCount('active_publications', 0);
    }

    public function test_staging_integrity_is_checked_before_publication(): void
    {
        $m = $this->uploaded();
        $this->postJson($this->url($m, '/finalize'), [], $this->headers)->assertOk();
        DB::table('staging_records')->where('ordinal', 0)->update(['hash' => str_repeat('0', 64)]);
        $this->postJson($this->url($m, '/publish'), [], $this->headers)->assertConflict();
        $this->assertDatabaseCount('publications', 0);
    }

    public function test_publication_is_immutable_and_rollback_is_atomic_compare_and_swap(): void
    {
        $a = $this->published();
        $b = $this->published([$this->rows[2]]);
        $read = $this->readHeaders();
        $this->getJson('/api/v1/datasets/'.$this->dataset.'/records', $read)->assertJsonPath('total', 1);
        $this->getJson('/api/v1/datasets/'.$this->dataset.'/records?publicationId='.$a['publicationId'], $read)->assertJsonPath('total', 3);
        $body = ['publicationId' => $a['publicationId'], 'expectedActivePublicationId' => $b['publicationId']];
        $ops = ['Authorization' => 'Bearer '.str_repeat('c', 48)];
        $this->postJson('/api/v1/datasets/'.$this->dataset.'/rollback', $body, $read)->assertForbidden();
        $this->postJson('/api/v1/datasets/'.$this->dataset.'/rollback', $body, $ops)->assertOk();
        $this->postJson('/api/v1/datasets/'.$this->dataset.'/rollback', $body, $ops)->assertConflict();
        $this->getJson('/api/v1/datasets/'.$this->dataset.'/records', $read)->assertJsonPath('total', 3);
        $this->assertDatabaseCount('publications', 2);
        $this->postJson($this->url($b, '/publish'), [], $this->headers)->assertOk();
        $this->getJson('/api/v1/datasets/'.$this->dataset.'/records', $read)->assertJsonPath('publicationId', $a['publicationId']);
    }

    public function test_cancelled_runs_and_stale_runs_cannot_replace_active(): void
    {
        $m = $this->uploaded();
        $this->postJson($this->url($m, '/cancel'), [], $this->headers)->assertOk();
        $this->postJson($this->url($m, '/finalize'), [], $this->headers)->assertConflict();
        $new = $this->manifest();
        $new['startedAt'] = '2026-10-26T02:00:00.000Z';
        $new['completedAt'] = '2026-10-26T02:00:01.000Z';
        $this->postJson('/api/v1/sync/runs', $new, $this->headers)->assertCreated();
        $this->putJson($this->url($new, '/batches/0'), $this->batchBody($this->rows), $this->headers)->assertOk();
        $this->postJson($this->url($new, '/finalize'), [], $this->headers)->assertOk();
        $this->postJson($this->url($new, '/publish'), [], $this->headers)->assertOk();
        $old = $this->uploaded();
        $this->postJson($this->url($old, '/finalize'), [], $this->headers)->assertOk();
        $this->postJson($this->url($old, '/publish'), [], $this->headers)->assertConflict();
    }

    public function test_bad_row_types_roll_back_entire_batch(): void
    {
        $rows = $this->rows;
        $rows[1][2] = 123;
        $m = $this->manifest($rows);
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertCreated();
        $this->putJson($this->url($m, '/batches/0'), $this->batchBody($rows), $this->headers)->assertUnprocessable();
        $this->assertDatabaseCount('staging_records', 0);
        $this->assertDatabaseCount('sync_batches', 0);
    }

    public function test_unknown_filters_are_rejected_and_pagination_pins_publication(): void
    {
        $m = $this->published();
        $this->getJson('/api/v1/datasets/'.$this->dataset.'/records?sql=DROP', $this->readHeaders())->assertUnprocessable();
        $this->getJson('/api/v1/datasets/'.$this->dataset.'/records?pageSize=1&page=2&publicationId='.$m['publicationId'], $this->readHeaders())->assertOk()->assertJsonCount(1, 'records')->assertJsonPath('records.0.ordinal', 1);
    }

    public function test_fixture_tokens_and_schemas_are_never_accepted_in_production_mode(): void
    {
        config(['sync.allow_fixtures' => false]);
        $this->postJson('/api/v1/sync/runs', $this->manifest(), $this->headers)->assertForbidden();
    }

    public function test_schema_revocation_prevents_finalizing_and_publishing(): void
    {
        $m = $this->uploaded();
        DB::table('integration_schemas')->where('integration_id', $this->dataset)->update(['approved' => false]);
        $this->postJson($this->url($m, '/finalize'), [], $this->headers)->assertConflict();
        $this->assertDatabaseCount('publications', 0);
    }

    public function test_failed_pointer_switch_rolls_back_new_publication_and_keeps_previous(): void
    {
        $a = $this->published();
        $b = $this->uploaded([$this->rows[2]]);
        $this->postJson($this->url($b, '/finalize'), [], $this->headers)->assertOk();
        DB::connection()->beforeExecuting(function ($query) {
            if (str_contains(strtolower($query), 'update') && str_contains($query, 'active_publications')) {
                throw new \RuntimeException('SIMULATED_STORAGE_FAILURE');
            }
        });
        $this->postJson($this->url($b, '/publish'), [], $this->headers)->assertStatus(500);
        $this->assertDatabaseCount('publications', 1);
        $this->assertDatabaseCount('published_records', 3);
        $this->assertDatabaseHas('active_publications', ['publication_id' => $a['publicationId']]);
        $this->assertDatabaseHas('sync_runs', ['id' => $b['runId'], 'status' => 'finalized']);
    }

    public function test_diamond_production_gate_needs_approved_code_matching_every_row(): void
    {
        $this->dataset = 'diamond-bridge-altas-bajas';
        DB::table('service_tokens')->where('hash', hash('sha256', str_repeat('a', 48)))->update(['simulation' => false]);
        DB::table('integrations')->where('id', $this->dataset)->update(['enabled' => true, 'publication_enabled' => true]);
        DB::table('integration_schemas')->where('integration_id', $this->dataset)->update(['simulation' => false]);
        $m = $this->manifest();
        $m['simulation'] = false;
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertCreated();
        $this->putJson($this->url($m, '/batches/0'), $this->batchBody($this->rows), $this->headers)->assertOk();
        $this->postJson($this->url($m, '/finalize'), [], $this->headers)->assertForbidden();
        // Deliberately fictional code used only in the transactional test database.
        DB::table('integrations')->where('id', $this->dataset)->update(['approved_company_code' => 'ZZ']);
        $this->postJson($this->url($m, '/finalize'), [], $this->headers)->assertUnprocessable();
        $this->assertDatabaseCount('publications', 0);
    }

    public function test_diamond_null_is_retained_and_production_remains_blocked(): void
    {
        $this->dataset = 'diamond-bridge-altas-bajas';
        $this->rows[0][0] = null;
        $m = $this->published([$this->rows[0]]);
        $this->getJson('/api/v1/datasets/'.$this->dataset.'/records', $this->readHeaders())->assertOk()->assertJsonPath('records.0.values.0', null);
        $this->assertFalse((bool) DB::table('integrations')->where('id', $this->dataset)->value('publication_enabled'));
    }

    public function test_invalid_dates_are_rejected_and_historical_corruption_blocks_rollback(): void
    {
        $rows = $this->rows;
        $rows[0][15] = '2026-02-29';
        $m = $this->manifest($rows);
        $this->postJson('/api/v1/sync/runs', $m, $this->headers)->assertCreated();
        $this->putJson($this->url($m, '/batches/0'), $this->batchBody($rows), $this->headers)->assertUnprocessable();
        $a = $this->published();
        $b = $this->published([$this->rows[2]]);
        DB::table('staging_records')->where('run_id', $a['runId'])->where('ordinal', 0)->update(['hash' => str_repeat('0', 64)]);
        $this->postJson('/api/v1/datasets/'.$this->dataset.'/rollback', ['publicationId' => $a['publicationId'], 'expectedActivePublicationId' => $b['publicationId']], ['Authorization' => 'Bearer '.str_repeat('c',48)])->assertConflict();
        $this->assertDatabaseHas('active_publications',['publication_id' => $b['publicationId']]);
    }
}
