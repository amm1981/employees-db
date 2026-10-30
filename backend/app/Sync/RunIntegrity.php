<?php

namespace App\Sync;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

final class RunIntegrity
{
    public function verify(object $run): void
    {
        $s = DB::table('integration_schemas')->where('id', $run->schema_id)->first();
        $manifest = json_decode($run->manifest, true, 512, JSON_THROW_ON_ERROR);
        abort_unless($s && $s->approved && hash_equals($s->hash, $manifest['schemaHash']) && hash_equals($s->hash, Canonical::hash($manifest['schema'])), 409, 'SCHEMA_REVOKED_OR_CHANGED');
        $i = DB::table('integrations')->where('id', $run->integration_id)->first();
        $validateCompany = ! $run->simulation && $run->integration_id === 'diamond-bridge-altas-bajas';
        abort_if($validateCompany && ! $i->approved_company_code, 403, 'COMPANY_CODE_PENDING');
        abort_unless(DB::table('sync_batches')->where('run_id', $run->id)->count() === $run->expected_batches, 409, 'BATCHES_INCOMPLETE');
        $rows = 0;
        $bytes = 0;
        foreach (DB::table('sync_partitions')->where('run_id', $run->id)->orderBy('number')->cursor() as $p) {
            $records = DB::table('staging_records')->where('run_id', $run->id)->where('batch_number', $p->number)->orderBy('ordinal')->get();
            abort_unless(count($records) === $p->row_count && $p->first_ordinal === $rows, 409, 'ROWS_INCOMPLETE');
            $payload = [];
            foreach ($records as $n => $record) {
                $plain = Crypt::decryptString($record->payload);
                abort_unless($record->ordinal === $rows + $n && hash_equals($record->hash, hash('sha256', $plain)), 409, 'ROW_INTEGRITY');
                $row = json_decode($plain, true, 512, JSON_THROW_ON_ERROR);
                abort_if($validateCompany && $row[0] !== $i->approved_company_code, 422, 'COMPANY_CODE_MISMATCH');
                $payload[] = $row;
            }
            $data = Canonical::encode($payload);
            abort_unless(hash_equals($p->hash, hash('sha256', $data)) && strlen($data) === $p->byte_count, 409, 'PARTITION_INTEGRITY');
            $rows += $p->row_count;
            $bytes += $p->byte_count;
        }
        abort_unless($rows === $run->expected_rows && $bytes === $run->expected_bytes && DB::table('staging_records')->where('run_id', $run->id)->count() === $rows, 409, 'RUN_TOTAL');
    }
}
