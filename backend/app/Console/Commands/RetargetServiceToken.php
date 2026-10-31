<?php

namespace App\Console\Commands;

use App\Sync\Canonical;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class RetargetServiceToken extends Command
{
    protected $signature = 'service-token:retarget {origin} {from} {to} {--token-file=}';

    protected $description = 'Move one identified agent token to another enabled dataset, preserving its secret and expiry';

    public function handle(): int
    {
        $file = $this->option('token-file');
        $line = is_string($file) && is_file($file) && filesize($file) <= 256 ? file_get_contents($file) : '';
        if (! preg_match('/\AAPI_INGEST_TOKEN=([a-f0-9]{64})\s*\z/D', $line, $match)) {
            $this->error('PROTECTED_TOKEN_FILE_REQUIRED');
            return self::FAILURE;
        }
        $hash = hash('sha256', $match[1]);
        unset($line, $match);
        return DB::transaction(function () use ($hash) {
            $to = $this->argument('to');
            $target = DB::table('integrations')->where('id', $to)->lockForUpdate()->first();
            $token = DB::table('service_tokens')->where('hash', $hash)->lockForUpdate()->first();
            if (! $target || ! $target->enabled || ! $target->publication_enabled || ! $token || $token->origin !== $this->argument('origin') || $token->simulation || $token->revoked_at || $token->expires_at <= now()->toDateTimeString()) {
                $this->error('TOKEN_OR_TARGET_INVALID');
                return self::FAILURE;
            }
            $current = json_decode($token->integrations, true);
            if ($current !== [$this->argument('from')] && $current !== [$to]) {
                $this->error('TOKEN_DATASET_CONFLICT');
                return self::FAILURE;
            }
            DB::table('service_tokens')->where('id', $token->id)->update(['integrations' => Canonical::encode([$to])]);
            DB::table('audit_events')->insert(['action' => 'token.retargeted', 'integration_id' => $to, 'details' => Canonical::encode(['tokenId' => $token->id, 'from' => $this->argument('from'), 'to' => $to]), 'created_at' => now()]);
            $this->info('Agent token retargeted. Secret and expiry preserved.');
            return self::SUCCESS;
        });
    }
}
