<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class ConsumerToken
{
    public function handle(Request $r, Closure $next): Response
    {
        $raw = $r->bearerToken();
        abort_unless($raw && preg_match('/^[0-9a-f]{64}$/D', $raw), 401, 'TOKEN_INVALID');
        $token = DB::table('consumer_access_tokens')->where('hash', hash('sha256', $raw))->whereNull('revoked_at')->where('expires_at', '>', now())->first();
        abort_unless($token, 401, 'TOKEN_INVALID');
        $consumer = DB::table('api_consumers')->where('id', $token->consumer_id)->where('enabled', true)->first();
        abort_unless($consumer, 401, 'TOKEN_INVALID');
        abort_if($consumer->simulation && (! config('sync.allow_fixtures') || ! app()->environment(['local', 'testing'])), 403, 'FIXTURES_DISABLED');
        $r->attributes->set('consumer', $consumer);
        $r->attributes->set('consumer_token', $token);

        return $next($r);
    }
}
