<?php

namespace App\Console\Commands;

use App\Sync\Canonical;
use App\Sync\Contract;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class ActivateIntegration extends Command
{
    protected $signature = 'integration:activate {integration}';

    protected $description = 'Activate a reviewed company contract and its explicit company-code policy';

    public function handle(): int
    {
        $id = $this->argument('integration');
        $targets = [
            'casablanca-altas-bajas' => ['CASABLANCA', 'casablanca.reviewed-v1.json'],
            'diamond-bridge-altas-bajas' => ['DIAMOND_BRIDGE_SAC', 'diamond-bridge.reviewed-v1.json'],
        ];
        if (! isset($targets[$id])) {
            $this->error('INTEGRATION_NOT_SUPPORTED');

            return self::FAILURE;
        }
        [$company, $file] = $targets[$id];
        $document = json_decode(file_get_contents(base_path('../contracts/schemas/'.$file)), true, 512, JSON_THROW_ON_ERROR);
        $schema = $document['schema'];
        $policy = $document['companyCodePolicy'] ?? 'required';
        if ($document['status'] !== 'reviewed' || $document['integrationId'] !== $id || ! hash_equals($document['schemaHash'], Canonical::hash($schema)) || array_column($schema['columns'], 'name') !== Contract::NAMES || ($id === 'diamond-bridge-altas-bajas' && ($policy !== 'preserve-null' || ! $schema['columns'][0]['nullable']))) {
            $this->error('REVIEWED_CONTRACT_INVALID');

            return self::FAILURE;
        }

        return DB::transaction(function () use ($id, $document, $schema, $company, $policy) {
            DB::table('integrations')->insertOrIgnore(['id' => $id, 'company' => $company, 'created_at' => now(), 'updated_at' => now()]);
            $integration = DB::table('integrations')->where('id', $id)->lockForUpdate()->first();
            if (! $integration || $integration->company !== $company || $integration->mode !== 'ROLLING_WINDOW_CAPTURE') {
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
            $update = ['enabled' => true, 'publication_enabled' => true, 'company_code_policy' => $policy, 'updated_at' => now()];
            if ($policy === 'preserve-null') $update['approved_company_code'] = null;
            DB::table('integrations')->where('id', $id)->update($update);
            DB::table('audit_events')->insert(['action' => 'integration.activated', 'integration_id' => $id, 'details' => Canonical::encode(['schemaHash' => $document['schemaHash'], 'companyCodePolicy' => $policy]), 'created_at' => now()]);
            $this->info($company.' activated. Schema SHA-256: '.$document['schemaHash'].'; company code policy: '.$policy);

            return self::SUCCESS;
        });
    }
}
