<?php

namespace App\Console\Commands;

use App\Sync\Canonical;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class AssignConsumer extends Command
{
    protected $signature = 'consumer:assign {username} {--dataset=*}';

    protected $description = 'Replace consumer datasets without changing its password; revoke existing sessions';

    public function handle(): int
    {
        $datasets = array_values(array_unique($this->option('dataset')));
        if (! $datasets || count($datasets) > 100 || DB::table('integrations')->whereIn('id', $datasets)->count() !== count($datasets)) {
            $this->error('DATASETS_INVALID');
            return self::FAILURE;
        }
        return DB::transaction(function () use ($datasets) {
            $consumer = DB::table('api_consumers')->where('username', $this->argument('username'))->lockForUpdate()->first();
            if (! $consumer || ! $consumer->enabled) {
                $this->error('CONSUMER_UNKNOWN_OR_DISABLED');
                return self::FAILURE;
            }
            DB::table('api_consumers')->where('id', $consumer->id)->update(['integrations' => Canonical::encode($datasets), 'updated_at' => now()]);
            DB::table('consumer_access_tokens')->where('consumer_id', $consumer->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
            DB::table('audit_events')->insert(['action' => 'consumer.datasets_assigned', 'details' => Canonical::encode(['consumerId' => $consumer->id, 'datasets' => $datasets]), 'created_at' => now()]);
            $this->info('Consumer datasets assigned. Password preserved; log in again.');
            return self::SUCCESS;
        });
    }
}
