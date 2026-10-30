<?php

namespace App\Http\Controllers;

use App\Sync\Access;
use App\Sync\RunIntegrity;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

final class DatasetController extends Controller
{
    public function index(Request $r)
    {
        $t = $r->attributes->get('service_token');
        abort_unless(in_array('read', json_decode($t->scopes, true), true), 403, 'READ_REQUIRED');
        Access::audit($r, 'datasets.list');

        return response()->json(['datasets' => DB::table('integrations')->whereIn('id', json_decode($t->integrations, true))->get(['id', 'company', 'mode'])->map(fn ($i) => ['id' => $i->id, 'company' => $i->company, 'mode' => $i->mode, 'exhaustive' => false])]);
    }

    public function records(Request $r, string $datasetId)
    {
        $t = Access::check($r, $datasetId, 'read');
        abort_if(array_diff(array_keys($r->query()), ['page', 'pageSize', 'publicationId', 'ordinalFrom']), 422, 'FILTER_NOT_ALLOWED');
        $v = $r->validate(['page' => 'sometimes|integer|min:1|max:1000000', 'pageSize' => 'sometimes|integer|min:1|max:500', 'publicationId' => 'sometimes|uuid', 'ordinalFrom' => 'sometimes|integer|min:0']);
        $id = $v['publicationId'] ?? DB::table('active_publications')->where('integration_id', $datasetId)->value('publication_id');
        abort_unless($id, 404, 'NO_PUBLICATION');
        $p = DB::table('publications as p')->join('sync_runs as r', 'r.id', '=', 'p.run_id')->where('p.id', $id)->where('p.integration_id', $datasetId)->where('r.simulation', (bool) $t->simulation)->first(['p.*', 'r.schema_id', 'r.mode', 'r.source_started_at', 'r.source_completed_at']);
        abort_unless($p, 404, 'PUBLICATION_UNKNOWN');
        $q = DB::table('published_records as p')->join('staging_records as s', 's.id', '=', 'p.staging_record_id')->where('p.publication_id', $id)->where('p.ordinal', '>=', $v['ordinalFrom'] ?? 0);
        $count = (clone $q)->count();
        $page = (int) ($v['page'] ?? 1);
        $size = (int) ($v['pageSize'] ?? 100);
        $rows = $q->orderBy('p.ordinal')->offset(($page - 1) * $size)->limit($size)->get(['s.payload', 's.hash', 's.run_id', 's.ordinal', 's.batch_number'])->map(function ($s) {
            $plain = Crypt::decryptString($s->payload);
            abort_unless(hash_equals($s->hash, hash('sha256', $plain)), 409, 'ROW_INTEGRITY');

            return ['ordinal' => $s->ordinal, 'runId' => $s->run_id, 'batchNumber' => $s->batch_number, 'values' => json_decode($plain, true)];
        });
        Access::audit($r, 'records.read', $datasetId, $p->run_id, ['publicationId' => $id, 'page' => $page, 'count' => $rows->count()]);

        return response()->json(['datasetId' => $datasetId, 'publicationId' => $id, 'mode' => $p->mode, 'exhaustive' => false, 'sourceStartedAt' => $p->source_started_at, 'sourceCompletedAt' => $p->source_completed_at, 'schema' => json_decode(DB::table('integration_schemas')->where('id', $p->schema_id)->value('document'), true), 'page' => $page, 'pageSize' => $size, 'total' => $count, 'records' => $rows]);
    }

    public function publications(Request $r, string $datasetId)
    {
        $t = Access::check($r, $datasetId, 'read');
        abort_if(array_diff(array_keys($r->query()), ['page', 'pageSize']), 422, 'FILTER_NOT_ALLOWED');
        $v = $r->validate(['page' => 'sometimes|integer|min:1|max:1000000', 'pageSize' => 'sometimes|integer|min:1|max:100']);
        $q = DB::table('publications as p')->join('sync_runs as r', 'r.id', '=', 'p.run_id')->where('p.integration_id', $datasetId)->where('r.simulation', (bool) $t->simulation);
        $total = (clone $q)->count();
        $page = (int) ($v['page'] ?? 1);
        $size = (int) ($v['pageSize'] ?? 50);
        Access::audit($r, 'publications.read', $datasetId);

        return response()->json(['publications' => $q->orderByDesc('p.created_at')->orderBy('p.id')->offset(($page - 1) * $size)->limit($size)->get(['p.id', 'p.run_id', 'p.row_count', 'p.created_at']), 'page' => $page, 'total' => $total, 'activePublicationId' => DB::table('active_publications')->where('integration_id', $datasetId)->value('publication_id')]);
    }

    public function rollback(Request $r, string $datasetId)
    {
        $t = Access::check($r, $datasetId, 'rollback');
        $v = $r->validate(['publicationId' => 'required|uuid', 'expectedActivePublicationId' => 'required|uuid']);

        return DB::transaction(function () use ($r, $datasetId, $v, $t) {
            abort_unless(DB::table('integrations')->where('id', $datasetId)->lockForUpdate()->first(), 404, 'INTEGRATION_UNKNOWN');
            $active = DB::table('active_publications')->where('integration_id', $datasetId)->first();
            abort_unless($active && $active->publication_id === $v['expectedActivePublicationId'], 409, 'ACTIVE_CONFLICT');
            $p = DB::table('publications as p')->join('sync_runs as r', 'r.id', '=', 'p.run_id')->where('p.id', $v['publicationId'])->where('p.integration_id', $datasetId)->where('r.simulation', (bool) $t->simulation)->first(['p.*']);
            abort_unless($p, 404, 'PUBLICATION_UNKNOWN');
            $run = DB::table('sync_runs')->where('id', $p->run_id)->first();
            app(RunIntegrity::class)->verify($run);
            $last = 0;
            do {
                $refs = DB::table('published_records as p')->join('staging_records as s', 's.id', '=', 'p.staging_record_id')->where('p.publication_id', $p->id)->where('p.id', '>', $last)->orderBy('p.id')->limit(500)->get(['p.id', 'p.ordinal', 's.ordinal as source_ordinal', 's.run_id']);
                foreach ($refs as $ref) {
                    abort_unless($ref->ordinal === $ref->source_ordinal && $ref->run_id === $p->run_id, 409, 'PUBLICATION_INTEGRITY');
                    $last = $ref->id;
                }
            } while (count($refs) === 500);
            abort_unless(DB::table('published_records')->where('publication_id', $p->id)->count() === $p->row_count, 409, 'PUBLICATION_INTEGRITY');
            DB::table('active_publications')->where('integration_id', $datasetId)->update(['publication_id' => $p->id, 'updated_at' => now()]);
            Access::audit($r, 'publication.rollback', $datasetId, $p->run_id, ['publicationId' => $p->id, 'previousPublicationId' => $active->publication_id]);

            return response()->json(['publicationId' => $p->id]);
        }, 5);
    }
}
