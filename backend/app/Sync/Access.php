<?php

namespace App\Sync;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class Access
{
    public static function check(Request $r, string $id, string $scope, bool $ingest = false): object
    {
        $t = $r->attributes->get('service_token');
        abort_unless(in_array($id, json_decode($t->integrations, true), true) && in_array($scope, json_decode($t->scopes, true), true), 403, 'SCOPE_DENIED');
        if ($ingest) {
            abort_unless(hash_equals($t->origin, (string) $r->header('X-Agent-Origin')), 403, 'ORIGIN_DENIED');
        }

        return $t;
    }

    public static function audit(Request $r, string $action, ?string $id = null, ?string $run = null, array $details = []): void
    {
        DB::table('audit_events')->insert(['action' => $action, 'integration_id' => $id, 'run_id' => $run, 'token_id' => $r->attributes->get('service_token')?->id, 'correlation_id' => $run, 'details' => Canonical::encode($details), 'created_at' => now()]);
    }
}
