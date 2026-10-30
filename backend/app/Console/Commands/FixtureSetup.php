<?php

namespace App\Console\Commands;

use App\Sync\Canonical;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class FixtureSetup extends Command
{
    protected $signature = 'fixtures:setup {--secrets-file= : Absolute JSON path with ingestToken, readToken, opsToken}';

    protected $description = 'Install synthetic local fixtures and hashed service tokens; no production access';

    public function handle(): int
    {
        if (! app()->environment(['local', 'testing']) || ! config('sync.allow_fixtures')) {
            $this->error('FIXTURES_DISABLED');

            return 1;
        }
        $file = $this->option('secrets-file');
        if (! $file || ! is_file($file)) {
            $this->error('SECRETS_FILE_REQUIRED');

            return 1;
        }
        $tokens = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        foreach (['ingestToken', 'readToken', 'opsToken'] as $key) {
            if (! is_string($tokens[$key] ?? null) || strlen($tokens[$key]) < 40) {
                $this->error('TOKEN_ENTROPY_REQUIRED');

                return 1;
            }
        }
        DB::transaction(function () use ($tokens) {
            foreach (['casablanca-altas-bajas' => 'CASABLANCA', 'diamond-bridge-altas-bajas' => 'DIAMOND_BRIDGE_SAC'] as $id => $company) {
                DB::table('integrations')->insertOrIgnore(['id' => $id, 'company' => $company, 'enabled' => false, 'publication_enabled' => false, 'created_at' => now(), 'updated_at' => now()]);
                $schema = json_decode(file_get_contents(base_path('../tests/fixtures/schema.json')), true, 512, JSON_THROW_ON_ERROR);
                DB::table('integration_schemas')->insertOrIgnore(['integration_id' => $id, 'version' => $schema['version'], 'hash' => Canonical::hash($schema), 'document' => Canonical::encode($schema), 'approved' => true, 'simulation' => true]);
            }
            foreach (['ingestToken' => ['ingest', 'publish', 'cancel'], 'readToken' => ['read'], 'opsToken' => ['rollback']] as $key => $scopes) {
                DB::table('service_tokens')->insertOrIgnore(['id' => (string) Str::uuid(), 'hash' => hash('sha256', $tokens[$key]), 'origin' => 'fixture-agent', 'integrations' => Canonical::encode(['casablanca-altas-bajas', 'diamond-bridge-altas-bajas']), 'scopes' => Canonical::encode($scopes), 'simulation' => true, 'expires_at' => now()->addDay()]);
                DB::table('service_tokens')->where('hash', hash('sha256', $tokens[$key]))->where('simulation', true)->update(['expires_at' => now()->addDay(), 'revoked_at' => null]);
            }
        });
        $this->info('Synthetic schemas and tokens installed. Production integrations remain disabled.');

        return 0;
    }
}
