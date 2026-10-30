<?php

namespace App\Console\Commands;

use App\Sync\Canonical;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class IssueServiceToken extends Command
{
    protected $signature = 'service-token:issue {integration} {origin} {--scope=*} {--days=30} {--secret-env=SERVICE_TOKEN_NEW}';

    protected $description = 'Hash an externally generated token from environment; never prints the secret';

    public function handle(): int
    {
        $scopes = $this->option('scope');
        $secret = getenv($this->option('secret-env'));
        $days = filter_var($this->option('days'), FILTER_VALIDATE_INT);
        if (! $secret || strlen($secret) < 40 || ! $days || $days < 1 || $days > 90 || ! $scopes || array_diff($scopes, ['ingest', 'publish', 'cancel', 'read', 'rollback']) || (in_array('read', $scopes) && count($scopes) > 1)) {
            $this->error('INVALID_TOKEN_CONFIGURATION');

            return 1;
        }
        if (! DB::table('integrations')->where('id', $this->argument('integration'))->exists()) {
            $this->error('INTEGRATION_UNKNOWN');

            return 1;
        }
        $id = (string) Str::uuid();
        DB::table('service_tokens')->insert(['id' => $id, 'hash' => hash('sha256', $secret), 'origin' => $this->argument('origin'), 'integrations' => Canonical::encode([$this->argument('integration')]), 'scopes' => Canonical::encode($scopes), 'simulation' => false, 'expires_at' => now()->addDays($days)]);
        $this->info('Token ID: '.$id);

        return 0;
    }
}
