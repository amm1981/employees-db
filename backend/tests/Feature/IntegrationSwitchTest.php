<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class IntegrationSwitchTest extends TestCase
{
    use RefreshDatabase;

    private string $from = 'casablanca-altas-bajas';
    private string $to = 'diamond-bridge-altas-bajas';

    public function test_retargeting_one_agent_token_preserves_secret_scopes_and_expiry_and_is_idempotent(): void
    {
        $this->artisan('integration:activate', ['integration' => $this->to])->assertSuccessful();
        $secret = str_repeat('f', 64);
        $id = (string) Str::uuid();
        $expiry = now()->addDays(7)->toDateTimeString();
        DB::table('service_tokens')->insert(['id' => $id, 'hash' => hash('sha256', $secret), 'origin' => 'ti-pc-01', 'integrations' => json_encode([$this->from]), 'scopes' => '["ingest","publish","cancel"]', 'simulation' => false, 'expires_at' => $expiry]);
        $file = tempnam(sys_get_temp_dir(), 'synthetic-agent-token-');
        file_put_contents($file, 'API_INGEST_TOKEN='.$secret."\n");
        $args = ['origin' => 'ti-pc-01', 'from' => $this->from, 'to' => $this->to, '--token-file' => $file];
        try {
            $this->artisan('service-token:retarget', array_merge($args, ['origin' => 'wrong-origin']))->assertFailed();
            $this->assertSame([$this->from], json_decode(DB::table('service_tokens')->value('integrations'), true));
            $this->artisan('service-token:retarget', $args)->assertSuccessful();
            $this->artisan('service-token:retarget', $args)->assertSuccessful();
            $token = DB::table('service_tokens')->first();
            $this->assertSame($id, $token->id);
            $this->assertSame(hash('sha256', $secret), $token->hash);
            $this->assertSame($expiry, $token->expires_at);
            $this->assertSame('["ingest","publish","cancel"]', $token->scopes);
            $this->assertSame([$this->to], json_decode($token->integrations, true));
            $this->assertStringNotContainsString($secret, json_encode(DB::table('audit_events')->get()));
            DB::table('service_tokens')->where('id', $id)->update(['integrations' => json_encode([$this->from, $this->to])]);
            $this->artisan('service-token:retarget', $args)->assertFailed();
            DB::table('service_tokens')->where('id', $id)->update(['integrations' => json_encode([$this->to]), 'revoked_at' => now()]);
            $this->artisan('service-token:retarget', $args)->assertFailed();
        } finally {
            unlink($file);
        }
    }

    public function test_disabling_the_previous_integration_preserves_its_schema_and_leaves_diamond_enabled(): void
    {
        $this->artisan('integration:activate', ['integration' => $this->from])->assertSuccessful();
        $this->artisan('integration:activate', ['integration' => $this->to])->assertSuccessful();
        $this->artisan('integration:disable', ['integration' => $this->from])->assertSuccessful();
        $this->artisan('integration:disable', ['integration' => $this->from])->assertSuccessful();
        $this->assertDatabaseHas('integrations', ['id' => $this->from, 'enabled' => false, 'publication_enabled' => false]);
        $this->assertDatabaseHas('integrations', ['id' => $this->to, 'enabled' => true, 'publication_enabled' => true]);
        $this->assertDatabaseCount('integration_schemas', 2);
    }
}
