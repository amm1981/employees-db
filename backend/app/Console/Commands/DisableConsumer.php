<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class DisableConsumer extends Command
{
    protected $signature = 'consumer:disable {username}';

    protected $description = 'Disable a consumer and revoke all of its access tokens';

    public function handle(): int
    {
        return DB::transaction(function () {
            $consumer = DB::table('api_consumers')->where('username', $this->argument('username'))->lockForUpdate()->first();
            if (! $consumer) {
                $this->error('CONSUMER_UNKNOWN');

                return self::FAILURE;
            }
            DB::table('api_consumers')->where('id', $consumer->id)->update(['enabled' => false, 'updated_at' => now()]);
            DB::table('consumer_access_tokens')->where('consumer_id', $consumer->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
            DB::table('audit_events')->insert(['action' => 'consumer.disabled', 'details' => json_encode(['consumerId' => $consumer->id]), 'created_at' => now()]);
            $this->info('Consumer disabled; tokens revoked.');

            return self::SUCCESS;
        });
    }
}
