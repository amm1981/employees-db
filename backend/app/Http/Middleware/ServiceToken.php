<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class ServiceToken
{
    public function handle(Request $r, Closure $next): Response
    {
        $raw = $r->bearerToken();
        abort_unless($raw && strlen($raw) <= 512, 401, 'TOKEN_REQUIRED');
        $token = DB::table('service_tokens')->where('hash', hash('sha256', $raw))->whereNull('revoked_at')->where('expires_at', '>', now())->first();
        abort_unless($token, 401, 'TOKEN_INVALID');
        abort_if($token->simulation && (! config('sync.allow_fixtures') || ! app()->environment(['local', 'testing'])), 403, 'FIXTURES_DISABLED');
        $r->attributes->set('service_token', $token);

        return $next($r);
    }
}
