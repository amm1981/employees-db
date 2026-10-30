<?php

namespace Tests\Feature;

use App\Sync\Canonical;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class ConsumerApiTest extends TestCase
{
    use RefreshDatabase;

    private array $schema;

    private string $dataset = 'casablanca-altas-bajas';

    private string $password = 'fixture-password-2026';

    protected function setUp(): void
    {
        parent::setUp();
        config(['sync.allow_fixtures' => true, 'consumer.source_timezone' => 'America/Lima']);
        $this->travelTo(Carbon::parse('2026-10-30T17:00:00Z'));
        $this->schema = json_decode(file_get_contents(base_path('../tests/fixtures/schema.json')), true);
        foreach ([34, 35] as $n) {
            $this->schema['columns'][$n] = array_merge($this->schema['columns'][36], ['name' => $this->schema['columns'][$n]['name']]);
        }
        foreach ([$this->dataset, 'diamond-bridge-altas-bajas'] as $id) {
            DB::table('integrations')->insert(['id' => $id, 'company' => 'FICTIONAL', 'created_at' => now(), 'updated_at' => now()]);
            DB::table('integration_schemas')->insert(['integration_id' => $id, 'version' => $this->schema['version'], 'hash' => Canonical::hash($this->schema), 'document' => Canonical::encode($this->schema), 'approved' => true, 'simulation' => true]);
        }
        DB::table('api_consumers')->insert(['id' => (string) Str::uuid(), 'username' => 'fixture.reader', 'password' => Hash::make($this->password), 'integrations' => json_encode([$this->dataset]), 'simulation' => true, 'enabled' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('service_tokens')->insert(['id' => (string) Str::uuid(), 'hash' => hash('sha256', str_repeat('a', 64)), 'origin' => 'fixture-agent', 'integrations' => json_encode([$this->dataset, 'diamond-bridge-altas-bajas']), 'scopes' => json_encode(['ingest', 'publish']), 'simulation' => true, 'expires_at' => now()->addDay()]);
    }

    private function login(): array
    {
        $r = $this->postJson('/api/v1/auth/login', ['username' => 'fixture.reader', 'password' => $this->password])->assertOk()->assertHeader('Cache-Control', 'no-store, private')->assertJsonPath('token_type', 'Bearer')->assertJsonPath('expires_in', 3600);

        return ['Authorization' => 'Bearer '.$r->json('access_token')];
    }

    private function row(?string $date): array
    {
        $row = json_decode(file_get_contents(base_path('../tests/fixtures/rows.json')), true)[0];
        $row[34] = null;
        $row[35] = null;
        $row[36] = $date;

        return $row;
    }

    private function publish(array $rows, ?string $dataset = null): string
    {
        $dataset ??= $this->dataset;
        $id = (string) Str::uuid();
        $headers = ['Authorization' => 'Bearer '.str_repeat('a', 64), 'X-Agent-Origin' => 'fixture-agent'];
        $batch = ['hash' => Canonical::hash($rows), 'first' => 0, 'count' => count($rows), 'rows' => $rows];
        $manifest = ['protocol' => 1, 'runId' => $id, 'integrationId' => $dataset, 'dataset' => $dataset, 'origin' => 'fixture-agent', 'simulation' => true, 'mode' => 'ROLLING_WINDOW_CAPTURE', 'schema' => $this->schema, 'schemaHash' => Canonical::hash($this->schema), 'startedAt' => now()->subSecond()->toIso8601String(), 'completedAt' => now()->toIso8601String(), 'totalRows' => count($rows), 'totalBytes' => strlen(Canonical::encode($rows)), 'batches' => [['number' => 0, 'first' => 0, 'count' => count($rows), 'bytes' => strlen(Canonical::encode($rows)), 'hash' => Canonical::hash($rows)]]];
        $url = '/api/v1/sync/runs';
        $this->postJson($url, $manifest, $headers)->assertCreated();
        $this->putJson($url.'/'.$id.'/batches/0', $batch, $headers)->assertOk();
        $this->postJson($url.'/'.$id.'/finalize', [], $headers)->assertOk();

        return $this->postJson($url.'/'.$id.'/publish', [], $headers)->assertOk()->json('publicationId');
    }

    private function employees(array $headers, string $extra = '')
    {
        return $this->getJson('/api/v1/employees?dataset='.$this->dataset.$extra, $headers);
    }

    public function test_login_hashes_tokens_and_never_returns_credentials(): void
    {
        $headers = $this->login();
        $raw = substr($headers['Authorization'], 7);
        $this->assertSame(64, strlen($raw));
        $token = DB::table('consumer_access_tokens')->first();
        $this->assertSame(hash('sha256', $raw), $token->hash);
        $this->assertNotSame($raw, $token->hash);
        $this->assertStringNotContainsString($raw, json_encode(DB::table('audit_events')->get()));
        $this->assertNotSame($this->password, DB::table('api_consumers')->value('password'));
        $this->employees($headers)->assertNotFound();
    }

    public function test_bad_unknown_and_disabled_credentials_have_the_same_error(): void
    {
        foreach ([['fixture.reader', 'incorrect-password'], ['unknown.reader', $this->password]] as [$username, $password]) {
            $this->postJson('/api/v1/auth/login', compact('username', 'password'))->assertUnauthorized()->assertExactJson(['error' => ['code' => 'INVALID_CREDENTIALS']]);
        }
        DB::table('api_consumers')->update(['enabled' => false]);
        $this->postJson('/api/v1/auth/login', ['username' => 'fixture.reader', 'password' => $this->password])->assertUnauthorized()->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
        $this->assertDatabaseCount('consumer_access_tokens', 0);
    }

    public function test_login_requires_json_body_and_throttles_password_guessing(): void
    {
        $this->postJson('/api/v1/auth/login?username=fixture.reader', ['password' => $this->password])->assertUnprocessable();
        $this->post('/api/v1/auth/login', ['username' => 'fixture.reader', 'password' => $this->password])->assertStatus(415);
        for ($n = 0; $n < 5; $n++) {
            $this->postJson('/api/v1/auth/login', ['username' => 'guess.target', 'password' => 'wrong'])->assertUnauthorized();
        }
        $this->postJson('/api/v1/auth/login', ['username' => 'guess.target', 'password' => 'wrong'])->assertStatus(429)->assertHeader('Retry-After');
    }

    public function test_logout_expiry_revocation_and_disabled_accounts_reject_tokens(): void
    {
        $headers = $this->login();
        $this->postJson('/api/v1/auth/logout', [], $headers)->assertNoContent();
        $this->employees($headers)->assertUnauthorized();
        $headers = $this->login();
        DB::table('consumer_access_tokens')->update(['expires_at' => now()]);
        $this->employees($headers)->assertUnauthorized();
        $headers = $this->login();
        $this->artisan('consumer:disable', ['username' => 'fixture.reader'])->assertSuccessful();
        $this->employees($headers)->assertUnauthorized();
        $this->assertSame(0, DB::table('consumer_access_tokens')->whereNull('revoked_at')->count());
    }

    public function test_consumer_tokens_cannot_read_raw_history_or_ingest_and_service_tokens_cannot_read_employees(): void
    {
        $headers = $this->login();
        $this->getJson('/api/v1/datasets/'.$this->dataset.'/records', $headers)->assertUnauthorized();
        $this->postJson('/api/v1/sync/runs', [], $headers)->assertUnauthorized();
        $this->employees(['Authorization' => 'Bearer '.str_repeat('a', 64)])->assertUnauthorized();
        $this->employees([])->assertUnauthorized();
        $this->getJson('/api/v1/employees?dataset=diamond-bridge-altas-bajas', $headers)->assertForbidden();
    }

    public function test_exact_72_hour_window_preserves_duplicates_names_nulls_and_all_seven_fractional_digits(): void
    {
        $lower = $this->row('2026-10-27T12:00:00.0000000');
        $older = $this->row('2026-10-27T11:59:59.9999999');
        $upper = $this->row('2026-10-30T12:00:00.0000000');
        $future = $this->row('2026-10-30T12:00:00.0000001');
        $personal = $older;
        $personal[34] = '2026-10-29T08:03:04.1234567';
        $agenda = $older;
        $agenda[35] = '2026-10-29T08:03:04.1234567';
        $this->publish([$lower, $lower, $older, $upper, $future, $this->row(null), $personal, $agenda]);
        $response = $this->employees($this->login())->assertOk()->assertJsonPath('total', 5)->assertJsonPath('exhaustive', false)->assertJsonPath('window.hours', 72)->assertJsonPath('window.from', '2026-10-27T17:00:00.0000000Z');
        $this->assertSame([0, 1, 3, 6, 7], array_column($response->json('records'), 'ordinal'));
        $first = $response->json('records.0.values');
        $this->assertSame(37, count($first));
        $this->assertSame('00001234', $first['cod_trabajador']);
        $this->assertSame('', $first['apellido_mat']);
        $this->assertNull($first['cod_categoria']);
        $this->assertSame($first, $response->json('records.1.values'));
        $this->assertSame('2026-10-29T13:03:04.1234567', DB::table('staging_records')->where('ordinal', 6)->value('worker_changed_at'));
    }

    public function test_last_publication_pagination_scope_and_filter_limits(): void
    {
        $first = $this->publish([$this->row('2026-10-29T12:00:00')]);
        $current = $this->publish(array_fill(0, 3, $this->row('2026-10-29T12:00:00')));
        $headers = $this->login();
        $this->employees($headers, '&pageSize=1&page=2')->assertOk()->assertJsonPath('total', 3)->assertJsonPath('publicationId', $current)->assertJsonPath('records.0.ordinal', 1)->assertJsonCount(1, 'records');
        $this->employees($headers, '&publicationId='.$first)->assertOk()->assertJsonPath('total', 1);
        $other = $this->publish([$this->row('2026-10-29T12:00:00')], 'diamond-bridge-altas-bajas');
        $this->employees($headers, '&publicationId='.$other)->assertNotFound();
        $this->employees($headers, '&days=90')->assertUnprocessable();
        $this->employees($headers, '&pageSize=501')->assertUnprocessable();
        $this->employees($headers, '&page=0')->assertUnprocessable();
        $this->getJson('/api/v1/employees', $headers)->assertUnprocessable();
    }

    public function test_stale_captures_age_out_and_simulation_is_isolated(): void
    {
        $this->publish([$this->row('2026-10-27T12:00:00')]);
        $headers = $this->login();
        $this->travel(1)->seconds();
        $this->employees($headers)->assertOk()->assertJsonPath('total', 0)->assertJsonCount(0, 'records');
        DB::table('api_consumers')->update(['simulation' => false]);
        $this->employees($headers)->assertNotFound();
        DB::table('api_consumers')->update(['simulation' => true]);
        config(['sync.allow_fixtures' => false]);
        $this->employees($headers)->assertForbidden();
    }

    public function test_existing_encrypted_captures_must_be_indexed_and_integrity_is_verified(): void
    {
        $this->publish([$this->row('2026-10-29T12:00:00')]);
        $headers = $this->login();
        $before = DB::table('staging_records')->value('payload');
        DB::table('staging_records')->update(['worker_changed_at' => null, 'worker_time_zone' => null]);
        $this->employees($headers)->assertStatus(409)->assertJsonPath('error.code', 'WORKER_INDEX_PENDING');
        $this->artisan('workers:index')->expectsOutput('Worker times indexed: 1')->assertSuccessful();
        $this->employees($headers)->assertOk()->assertJsonPath('total', 1);
        $this->assertSame($before, DB::table('staging_records')->value('payload'));
        $this->artisan('workers:index')->expectsOutput('Worker times indexed: 0')->assertSuccessful();
        DB::table('staging_records')->update(['payload' => Crypt::encryptString('[]')]);
        $this->employees($headers)->assertStatus(409)->assertJsonPath('error.code', 'ROW_INTEGRITY');
    }

    public function test_timezone_change_requires_reindex_and_explicit_offsets_are_preserved(): void
    {
        $this->schema['columns'][36]['sqlType'] = 'datetimeoffset';
        DB::table('integration_schemas')->update(['hash' => Canonical::hash($this->schema), 'document' => Canonical::encode($this->schema)]);
        $this->publish([$this->row('2026-10-27T17:00:00.0000000+00:00')]);
        $headers = $this->login();
        $this->employees($headers)->assertOk()->assertJsonPath('total', 1);
        config(['consumer.source_timezone' => 'UTC']);
        $this->employees($headers)->assertStatus(409)->assertJsonPath('error.code', 'WORKER_INDEX_PENDING');
        $this->artisan('workers:index')->assertSuccessful();
        $this->employees($headers)->assertOk()->assertJsonPath('total', 1);
    }

    public function test_consumer_creation_has_no_default_password_or_production_fixture_access(): void
    {
        putenv('CONSUMER_TEST_PASSWORD='.$this->password);
        try {
            $this->artisan('consumer:create', ['username' => 'fixture.other', '--dataset' => [$this->dataset], '--simulation' => true, '--password-env' => 'CONSUMER_TEST_PASSWORD', '--no-interaction' => true])->assertSuccessful();
            $this->assertTrue(Hash::check($this->password, DB::table('api_consumers')->where('username', 'fixture.other')->value('password')));
            $this->artisan('consumer:create', ['username' => 'fixture.other', '--dataset' => [$this->dataset], '--password-env' => 'CONSUMER_TEST_PASSWORD'])->assertFailed();
            $this->artisan('consumer:create', ['username' => 'other', '--dataset' => ['unknown'], '--password-env' => 'CONSUMER_TEST_PASSWORD'])->assertFailed();
            config(['sync.allow_fixtures' => false]);
            $this->artisan('consumer:create', ['username' => 'forbidden', '--dataset' => [$this->dataset], '--simulation' => true, '--password-env' => 'CONSUMER_TEST_PASSWORD'])->assertFailed();
        } finally {
            putenv('CONSUMER_TEST_PASSWORD');
        }
    }

    public function test_production_requires_https_and_the_configured_domain(): void
    {
        $this->app['env'] = 'production';
        config(['app.url' => 'https://api-employeedb.ccruces.com']);
        $body = ['username' => 'fixture.reader', 'password' => $this->password];
        $this->postJson('http://api-employeedb.ccruces.com/api/v1/auth/login', $body, ['X-Forwarded-Proto' => 'https'])->assertStatus(400)->assertJsonPath('error.code', 'HTTPS_REQUIRED');
        $this->postJson('https://wrong.example/api/v1/auth/login', $body)->assertStatus(400)->assertJsonPath('error.code', 'HOST_DENIED');
        $this->postJson('https://api-employeedb.ccruces.com/api/v1/auth/login', $body)->assertUnauthorized()->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
    }
}
