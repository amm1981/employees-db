<?php

namespace App\Console\Commands;

use App\Sync\Canonical;
use App\Sync\Contract;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class ActivateIntegration extends Command
{
    protected $signature = 'integration:activate {integration}';

    protected $description = 'Activate the reviewed CASABLANCA contract and enable production ingestion/publication';

    public function handle(): int
    {
        $id = $this->argument('integration');
        if ($id !== 'casablanca-altas-bajas') {
            $this->error('INTEGRATION_NOT_SUPPORTED');

            return self::FAILURE;
        }
        $document = json_decode(file_get_contents(base_path('../contracts/schemas/casablanca.reviewed-v1.json')), true, 512, JSON_THROW_ON_ERROR);
        $schema = $document['schema'];
        if ($document['status'] !== 'reviewed' || $document['integrationId'] !== $id || ! hash_equals($document['schemaHash'], Canonical::hash($schema)) || array_column($schema['columns'], 'name') !== Contract::NAMES) {
            $this->error('REVIEWED_CONTRACT_INVALID');

            return self::FAILURE;
        }

        return DB::transaction(function () use ($id, $document, $schema) {
            $integration = DB::table('integrations')->where('id', $id)->lockForUpdate()->first();
            if (! $integration || $integration->company !== 'CASABLANCA' || $integration->mode !== 'ROLLING_WINDOW_CAPTURE') {
                $this->error('INTEGRATION_UNKNOWN_OR_CHANGED');

                return self::FAILURE;
            }
            $existing = DB::table('integration_schemas')->where('integration_id', $id)->where('version', $schema['version'])->first();
            if ($existing && ($existing->simulation || ! hash_equals($existing->hash, $document['schemaHash']) || $existing->document !== Canonical::encode($schema))) {
                $this->error('SCHEMA_VERSION_CONFLICT');

                return self::FAILURE;
            }
            if (! $existing) {
                DB::table('integration_schemas')->insert(['integration_id' => $id, 'version' => $schema['version'], 'hash' => $document['schemaHash'], 'document' => Canonical::encode($schema), 'approved' => true, 'simulation' => false]);
            } else {
                DB::table('integration_schemas')->where('id', $existing->id)->update(['approved' => true]);
            }
            DB::table('integrations')->where('id', $id)->update(['enabled' => true, 'publication_enabled' => true, 'updated_at' => now()]);
            DB::table('audit_events')->insert(['action' => 'integration.activated', 'integration_id' => $id, 'details' => Canonical::encode(['schemaHash' => $document['schemaHash']]), 'created_at' => now()]);
            $this->info('CASABLANCA activated. Schema SHA-256: '.$document['schemaHash']);

            return self::SUCCESS;
        });
    }
}
