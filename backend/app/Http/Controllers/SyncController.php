<?php

namespace App\Http\Controllers;

use App\Sync\Access;
use App\Sync\Canonical;
use App\Sync\Contract;
use App\Sync\RunIntegrity;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class SyncController extends Controller
{
    public function create(Request $r)
    {
        $m = $r->validate([
            'protocol' => 'required|integer|in:1', 'runId' => 'required|uuid', 'integrationId' => 'required|string|max:80', 'dataset' => 'required|string|max:80',
            'origin' => 'required|string|max:100', 'simulation' => 'required|boolean', 'mode' => 'required|in:ROLLING_WINDOW_CAPTURE',
            'schema' => 'required|array:version,columns', 'schema.version' => 'required|string|max:80', 'schema.columns' => 'required|array|size:37',
            'schemaHash' => 'required|regex:/^[0-9a-f]{64}$/', 'startedAt' => 'required|date', 'completedAt' => 'required|date|after_or_equal:startedAt',
            'totalRows' => 'required|integer|min:0|max:1000000', 'totalBytes' => 'required|integer|min:0|max:536870912',
            'batches' => 'present|array|max:10000', 'batches.*' => 'required|array:number,first,count,bytes,hash',
            'batches.*.number' => 'required|integer|min:0', 'batches.*.first' => 'required|integer|min:0',
            'batches.*.count' => 'required|integer|min:1|max:5000', 'batches.*.bytes' => 'required|integer|min:2|max:2097152',
            'batches.*.hash' => 'required|regex:/^[0-9a-f]{64}$/',
        ]);
        $t = Access::check($r, $m['integrationId'], 'ingest', true);
        abort_unless(array_is_list($m['batches']) && array_is_list($m['schema']['columns']), 422, 'ARRAY_ORDER_REQUIRED');
        abort_unless($m['origin'] === $t->origin && $m['simulation'] === (bool) $t->simulation, 403, 'ORIGIN_OR_MODE_DENIED');
        abort_unless($m['dataset'] === $m['integrationId'], 422, 'DATASET_MISMATCH');

        return DB::transaction(function () use ($m, $r) {
            $i = DB::table('integrations')->where('id', $m['integrationId'])->lockForUpdate()->first();
            abort_unless($i, 404, 'INTEGRATION_UNKNOWN');
            $existing = DB::table('sync_runs')->where('id', $m['runId'])->first();
            if ($existing) {
                abort_unless($existing->integration_id === $i->id && hash_equals($existing->manifest_hash, Canonical::hash($m)), 409, 'RUN_CONFLICT');

                return response()->json(['runId' => $existing->id, 'status' => $existing->status]);
            }
            abort_unless($m['simulation'] || $i->enabled, 403, 'INTEGRATION_DISABLED');
            abort_unless($i->mode === $m['mode'], 422, 'MODE_DENIED');
            abort_if($m['totalRows'] === 0 && ! $i->allow_empty, 422, 'EMPTY_BLOCKED');
            abort_if($m['totalRows'] > $i->max_rows || $m['totalBytes'] > $i->max_bytes, 422, 'LIMIT_EXCEEDED');
            $s = DB::table('integration_schemas')->where('integration_id', $i->id)->where('version', $m['schema']['version'])->where('simulation', $m['simulation'])->where('approved', true)->first();
            abort_unless($s && hash_equals($s->hash, $m['schemaHash']) && hash_equals($s->hash, Canonical::hash($m['schema'])), 422, 'SCHEMA_NOT_APPROVED');
            abort_unless(Canonical::encode($m['schema']) === $s->document, 422, 'SCHEMA_CHANGED');
            $rows = 0;
            $bytes = 0;
            foreach ($m['batches'] as $n => $b) {
                abort_unless($b['number'] === $n && $b['first'] === $rows, 422, 'ORDINAL_RANGE');
                $rows += $b['count'];
                $bytes += $b['bytes'];
            }
            abort_unless($rows === $m['totalRows'] && $bytes === $m['totalBytes'], 422, 'MANIFEST_TOTAL');
            DB::table('sync_runs')->insert(['id' => $m['runId'], 'integration_id' => $i->id, 'schema_id' => $s->id, 'origin' => $m['origin'], 'simulation' => $m['simulation'], 'mode' => $m['mode'], 'status' => 'receiving', 'manifest_hash' => Canonical::hash($m), 'manifest' => Canonical::encode($m), 'expected_rows' => $rows, 'expected_bytes' => $bytes, 'expected_batches' => count($m['batches']), 'source_started_at' => Carbon::parse($m['startedAt']), 'source_completed_at' => Carbon::parse($m['completedAt']), 'created_at' => now(), 'updated_at' => now()]);
            foreach (array_chunk($m['batches'], 500) as $chunk) {
                DB::table('sync_partitions')->insert(array_map(fn ($b) => ['run_id' => $m['runId'], 'number' => $b['number'], 'first_ordinal' => $b['first'], 'row_count' => $b['count'], 'byte_count' => $b['bytes'], 'hash' => $b['hash']], $chunk));
            }
            Access::audit($r, 'run.created', $i->id, $m['runId'], ['rows' => $rows]);

            return response()->json(['runId' => $m['runId'], 'status' => 'receiving'], 201);
        }, 5);
    }

    private function run(Request $r, string $id, string $scope = 'ingest'): object
    {
        abort_unless(Str::isUuid($id), 422, 'INVALID_UUID');
        $run = DB::table('sync_runs')->where('id', $id)->first();
        abort_unless($run, 404, 'RUN_UNKNOWN');
        $t = Access::check($r, $run->integration_id, $scope, true);
        abort_unless($run->origin === $t->origin && (bool) $run->simulation === (bool) $t->simulation, 403, 'RUN_OWNER_DENIED');

        return $run;
    }

    private function locked(Request $r, string $id, string $scope, callable $f)
    {
        $run = $this->run($r, $id, $scope);

        return DB::transaction(function () use ($run, $f, $scope) {
            $i = DB::table('integrations')->where('id', $run->integration_id)->lockForUpdate()->first();
            $locked = DB::table('sync_runs')->where('id', $run->id)->lockForUpdate()->first();
            abort_unless($locked->simulation || $i->enabled || $scope === 'cancel', 403, 'INTEGRATION_DISABLED');

            return $f($locked, $i);
        }, 5);
    }

    public function show(Request $r, string $runId)
    {
        $run = $this->run($r, $runId);

        return response()->json(['runId' => $run->id, 'status' => $run->status, 'totalRows' => $run->expected_rows, 'receivedBatches' => DB::table('sync_batches')->where('run_id', $runId)->count()]);
    }

    public function batches(Request $r, string $runId)
    {
        $this->run($r, $runId);

        return response()->json(['runId' => $runId, 'batches' => DB::table('sync_batches')->where('run_id', $runId)->orderBy('number')->get(['number', 'hash'])]);
    }

    public function batch(Request $r, string $runId, string $batchNumber)
    {
        abort_unless(ctype_digit($batchNumber) && (int) $batchNumber < 10000, 422, 'BATCH_NUMBER');
        $b = $r->validate(['hash' => 'required|regex:/^[0-9a-f]{64}$/', 'first' => 'required|integer|min:0', 'count' => 'required|integer|min:1|max:5000', 'rows' => 'required|array|max:5000']);
        abort_unless(array_is_list($b['rows']) && count($b['rows']) === $b['count'], 422, 'BATCH_COUNT');

        return $this->locked($r, $runId, 'ingest', function ($run) use ($r, $b, $batchNumber) {
            $number = (int) $batchNumber;
            $existing = DB::table('sync_batches')->where('run_id', $run->id)->where('number', $number)->first();
            $p = DB::table('sync_partitions')->where('run_id', $run->id)->where('number', $number)->first();
            if ($existing) {
                abort_unless(hash_equals($existing->hash, $b['hash']) && hash_equals($existing->hash, Canonical::hash($b['rows'])) && $p && $p->first_ordinal == $b['first'] && $p->row_count == $b['count'], 409, 'BATCH_CONFLICT');

                return response()->json(['number' => $number, 'hash' => $existing->hash]);
            }
            abort_unless(hash_equals(Canonical::hash($b['rows']), $b['hash']), 422, 'BATCH_HASH');
            abort_unless($run->status === 'receiving', 409, 'RUN_NOT_RECEIVING');
            abort_unless($p && hash_equals($p->hash, $b['hash']) && $p->first_ordinal == $b['first'] && $p->row_count == $b['count'] && $p->byte_count === strlen(Canonical::encode($b['rows'])), 409, 'PARTITION_CONFLICT');
            $schema = json_decode(DB::table('integration_schemas')->where('id', $run->schema_id)->value('document'), true, 512, JSON_THROW_ON_ERROR);
            $inserts = [];
            foreach ($b['rows'] as $n => $row) {
                Contract::row($row, $schema);
                $inserts[] = ['run_id' => $run->id, 'ordinal' => $b['first'] + $n, 'batch_number' => $number, 'payload' => Crypt::encryptString(Canonical::encode($row)), 'hash' => Canonical::hash($row)];
            }
            foreach (array_chunk($inserts, 100) as $chunk) {
                DB::table('staging_records')->insert($chunk);
            }
            DB::table('sync_batches')->insert(['run_id' => $run->id, 'number' => $number, 'hash' => $b['hash'], 'row_count' => $b['count'], 'byte_count' => $p->byte_count, 'received_at' => now()]);
            Access::audit($r, 'batch.accepted', $run->integration_id, $run->id, ['number' => $number, 'rows' => $b['count']]);

            return response()->json(['number' => $number, 'hash' => $b['hash']]);
        });
    }

    public function finalize(Request $r, string $runId)
    {
        return $this->locked($r, $runId, 'ingest', function ($run) use ($r) {
            abort_if($run->status === 'cancelled', 409, 'RUN_CANCELLED');
            app(RunIntegrity::class)->verify($run);
            if ($run->status === 'receiving') {
                DB::table('sync_runs')->where('id', $run->id)->update(['status' => 'finalized', 'updated_at' => now()]);
                Access::audit($r, 'run.finalized', $run->integration_id, $run->id);
            }

            return response()->json(['runId' => $run->id, 'status' => $run->status === 'published' ? 'published' : 'finalized']);
        });
    }

    public function publish(Request $r, string $runId)
    {
        return $this->locked($r, $runId, 'publish', function ($run, $i) use ($r) {
            $existing = DB::table('publications')->where('run_id', $run->id)->first();
            if ($existing) {
                return response()->json(['runId' => $run->id, 'status' => 'published', 'publicationId' => $existing->id]);
            }
            abort_unless($run->status === 'finalized', 409, 'RUN_NOT_FINALIZED');
            abort_unless($run->simulation || ($i->enabled && $i->publication_enabled), 403, 'PUBLICATION_DISABLED');
            abort_if(! $run->simulation && $i->id === 'diamond-bridge-altas-bajas' && ! $i->approved_company_code, 403, 'COMPANY_CODE_PENDING');
            $active = DB::table('active_publications as a')->join('publications as p', 'p.id', '=', 'a.publication_id')->join('sync_runs as r', 'r.id', '=', 'p.run_id')->where('a.integration_id', $i->id)->first(['r.source_started_at']);
            abort_if($active && $active->source_started_at > $run->source_started_at, 409, 'STALE_PUBLICATION');
            app(RunIntegrity::class)->verify($run);
            $id = (string) Str::uuid();
            DB::table('publications')->insert(['id' => $id, 'integration_id' => $i->id, 'run_id' => $run->id, 'row_count' => $run->expected_rows, 'created_at' => now()]);
            DB::table('published_records')->insertUsing(['publication_id', 'staging_record_id', 'ordinal'], DB::table('staging_records')->selectRaw('? as publication_id, id, ordinal', [$id])->where('run_id', $run->id));
            DB::table('active_publications')->updateOrInsert(['integration_id' => $i->id], ['publication_id' => $id, 'updated_at' => now()]);
            DB::table('sync_runs')->where('id', $run->id)->update(['status' => 'published', 'updated_at' => now()]);
            Access::audit($r, 'run.published', $i->id, $run->id, ['publicationId' => $id, 'rows' => $run->expected_rows]);

            return response()->json(['runId' => $run->id, 'status' => 'published', 'publicationId' => $id]);
        });
    }

    public function cancel(Request $r, string $runId)
    {
        return $this->locked($r, $runId, 'cancel', function ($run) use ($r) {
            abort_if($run->status === 'published', 409, 'PUBLISHED_IMMUTABLE');
            DB::table('sync_runs')->where('id', $run->id)->update(['status' => 'cancelled', 'updated_at' => now()]);
            Access::audit($r, 'run.cancelled', $run->integration_id, $run->id);

            return response()->json(['runId' => $run->id, 'status' => 'cancelled']);
        });
    }
}
