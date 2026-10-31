<?php

namespace Tests\Feature;

use App\Sync\Canonical;
use App\Sync\Contract;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class ProductionContractTest extends TestCase
{
    use RefreshDatabase;

    private string $dataset = 'casablanca-altas-bajas';

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('integrations')->insert(['id' => $this->dataset, 'company' => 'CASABLANCA', 'created_at' => now(), 'updated_at' => now()]);
    }

    public function test_activation_is_explicit_idempotent_and_keeps_diamond_disabled(): void
    {
        $this->assertFalse((bool) DB::table('integrations')->value('enabled'));
        $this->artisan('integration:activate', ['integration' => $this->dataset])->assertSuccessful();
        $this->artisan('integration:activate', ['integration' => $this->dataset])->assertSuccessful();
        $this->assertDatabaseCount('integration_schemas', 1);
        $this->assertDatabaseHas('integration_schemas', ['approved' => true, 'simulation' => false, 'version' => 'casablanca-v1']);
        $this->assertDatabaseHas('integrations', ['id' => $this->dataset, 'enabled' => true, 'publication_enabled' => true]);
        $this->artisan('integration:activate', ['integration' => 'diamond-bridge-altas-bajas'])->assertFailed();
        DB::table('integration_schemas')->update(['hash' => str_repeat('0', 64)]);
        $this->artisan('integration:activate', ['integration' => $this->dataset])->assertFailed();
    }

    public function test_real_contract_ingestion_preserves_numeric18_cp1252_dates_and_duplicate_rows(): void
    {
        $this->artisan('integration:activate', ['integration' => $this->dataset])->assertSuccessful();
        $schema = json_decode(DB::table('integration_schemas')->value('document'), true);
        $row = array_map(fn ($c) => $c['nullable'] ? null : match ($c['sqlType']) {
            'int' => '1', 'numeric' => '999999999999999999', 'datetime' => '2026-10-31T09:00:00.003', default => 'A',
        }, $schema['columns']);
        $row[2] = '00001234';
        $row[5] = 'Ficticio ñá € —';
        $row[34] = '2026-10-31T09:00:00.997';
        $rows = [$row, $row];
        $secret = str_repeat('e', 64);
        DB::table('service_tokens')->insert(['id' => (string) Str::uuid(), 'hash' => hash('sha256', $secret), 'origin' => 'ti-pc-01', 'integrations' => json_encode([$this->dataset]), 'scopes' => json_encode(['ingest', 'publish']), 'simulation' => false, 'expires_at' => now()->addDay()]);
        $headers = ['Authorization' => 'Bearer '.$secret, 'X-Agent-Origin' => 'ti-pc-01'];
        $id = (string) Str::uuid();
        $hash = Canonical::hash($rows);
        $bytes = strlen(Canonical::encode($rows));
        $manifest = ['protocol' => 1, 'runId' => $id, 'integrationId' => $this->dataset, 'dataset' => $this->dataset, 'origin' => 'ti-pc-01', 'simulation' => false, 'mode' => 'ROLLING_WINDOW_CAPTURE', 'schema' => $schema, 'schemaHash' => Canonical::hash($schema), 'startedAt' => now()->subSecond()->toIso8601String(), 'completedAt' => now()->toIso8601String(), 'totalRows' => 2, 'totalBytes' => $bytes, 'batches' => [['number' => 0, 'first' => 0, 'count' => 2, 'bytes' => $bytes, 'hash' => $hash]]];
        $url = '/api/v1/sync/runs';
        $this->postJson($url, $manifest, $headers)->assertCreated();
        $this->putJson($url.'/'.$id.'/batches/0', ['hash' => $hash, 'first' => 0, 'count' => 2, 'rows' => $rows], $headers)->assertOk();
        $this->postJson($url.'/'.$id.'/finalize', [], $headers)->assertOk();
        $this->postJson($url.'/'.$id.'/publish', [], $headers)->assertOk();
        $this->assertDatabaseCount('published_records', 2);
        $this->assertSame('2026-10-31T14:00:00.9970000', DB::table('staging_records')->value('worker_changed_at'));
    }

    public function test_cp1252_width_and_invalid_characters_are_checked_consistently(): void
    {
        $schema = json_decode(file_get_contents(base_path('../tests/fixtures/schema.json')), true);
        $schema['columns'][2] = array_merge($schema['columns'][2], ['sqlType' => 'varchar', 'maxLength' => 1, 'collation' => 'Modern_Spanish_CI_AS']);
        $row = json_decode(file_get_contents(base_path('../tests/fixtures/rows.json')), true)[0];
        $row[2] = '€';
        Contract::row($row, $schema);
        foreach (['áá' => 'ROW_SIZE', '漢' => 'ROW_ENCODING', '😀' => 'ROW_ENCODING'] as $text => $code) {
            $row[2] = $text;
            try {
                Contract::row($row, $schema);
                $this->fail('Invalid value accepted');
            } catch (HttpException $e) {
                $this->assertSame($code, $e->getMessage());
            }
        }
    }
}
