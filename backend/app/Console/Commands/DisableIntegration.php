<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class DisableIntegration extends Command
{
    protected $signature = 'integration:disable {integration}';

    protected $description = 'Stop production ingestion/publication for an integration while preserving its history';

    public function handle(): int
    {
        return DB::transaction(function () {
            $id = $this->argument('integration');
            $integration = DB::table('integrations')->where('id', $id)->lockForUpdate()->first();
            if (! $integration) {
                $this->error('INTEGRATION_UNKNOWN');
                return self::FAILURE;
            }
            DB::table('integrations')->where('id', $id)->update(['enabled' => false, 'publication_enabled' => false, 'updated_at' => now()]);
            DB::table('audit_events')->insert(['action' => 'integration.disabled', 'integration_id' => $id, 'details' => '{}', 'created_at' => now()]);
            $this->info('Integration disabled; history preserved.');
            return self::SUCCESS;
        });
    }
}
