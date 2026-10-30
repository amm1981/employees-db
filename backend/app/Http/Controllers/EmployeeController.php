<?php

namespace App\Http\Controllers;

use App\Sync\WorkerTime;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

final class EmployeeController extends Controller
{
    public function index(Request $r)
    {
        abort_if(array_diff(array_keys($r->query()), ['dataset', 'page', 'pageSize', 'publicationId']), 422, 'FILTER_NOT_ALLOWED');
        $v = $r->validate(['dataset' => 'required|string|max:80', 'page' => 'sometimes|integer|min:1|max:1000000', 'pageSize' => 'sometimes|integer|min:1|max:500', 'publicationId' => 'sometimes|uuid']);
        $consumer = $r->attributes->get('consumer');
        abort_unless(in_array($v['dataset'], json_decode($consumer->integrations, true), true), 403, 'DATASET_DENIED');
        $id = $v['publicationId'] ?? DB::table('active_publications')->where('integration_id', $v['dataset'])->value('publication_id');
        abort_unless($id, 404, 'NO_PUBLICATION');
        $p = DB::table('publications as p')->join('sync_runs as r', 'r.id', '=', 'p.run_id')->where('p.id', $id)->where('p.integration_id', $v['dataset'])->where('r.simulation', (bool) $consumer->simulation)->first(['p.*', 'r.schema_id', 'r.source_completed_at']);
        abort_unless($p, 404, 'PUBLICATION_UNKNOWN');
        $schema = json_decode(DB::table('integration_schemas')->where('id', $p->schema_id)->value('document'), true, 512, JSON_THROW_ON_ERROR);
        $names = array_column($schema['columns'], 'name');
        $q = DB::table('published_records as p')->join('staging_records as s', 's.id', '=', 'p.staging_record_id')->where('p.publication_id', $id)->where('s.run_id', $p->run_id);
        $zone = config('consumer.source_timezone');
        abort_if((clone $q)->where(fn ($q) => $q->whereNull('s.worker_time_zone')->orWhere('s.worker_time_zone', '<>', $zone))->exists(), 409, 'WORKER_INDEX_PENDING');
        $end = CarbonImmutable::now('UTC');
        $from = $end->subHours(72)->format('Y-m-d\TH:i:s.u').'0';
        $until = $end->format('Y-m-d\TH:i:s.u').'0';
        $q->whereBetween('s.worker_changed_at', [$from, $until]);
        $total = (clone $q)->count();
        $page = (int) ($v['page'] ?? 1);
        $size = (int) ($v['pageSize'] ?? 100);
        $records = $q->orderBy('p.ordinal')->offset(($page - 1) * $size)->limit($size)->get(['p.ordinal', 's.payload', 's.hash', 's.worker_changed_at'])->map(function ($record) use ($names, $schema) {
            $plain = Crypt::decryptString($record->payload);
            abort_unless(hash_equals($record->hash, hash('sha256', $plain)), 409, 'ROW_INTEGRITY');
            $values = json_decode($plain, true, 512, JSON_THROW_ON_ERROR);
            abort_unless(WorkerTime::latest($values, $schema) === $record->worker_changed_at, 409, 'WORKER_TIME_INTEGRITY');

            return ['ordinal' => $record->ordinal, 'values' => array_combine($names, $values)];
        });
        DB::table('audit_events')->insert(['action' => 'employees.read', 'token_id' => $r->attributes->get('consumer_token')->id, 'integration_id' => $v['dataset'], 'run_id' => $p->run_id, 'details' => json_encode(['publicationId' => $id, 'page' => $page, 'count' => $records->count()]), 'created_at' => now()]);

        return response()->json(['datasetId' => $v['dataset'], 'publicationId' => $id, 'sourceCompletedAt' => $p->source_completed_at, 'mode' => 'ROLLING_WINDOW_CAPTURE', 'exhaustive' => false, 'window' => ['hours' => 72, 'from' => $from.'Z', 'to' => $until.'Z', 'sourceTimezone' => $zone, 'fields' => ['updpersonal', 'updagenda', 'updu']], 'page' => $page, 'pageSize' => $size, 'total' => $total, 'records' => $records]);
    }
}
