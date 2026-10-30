<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class ApiTransport
{
    public function handle(Request $r, Closure $next): Response
    {
        abort_if(strlen($r->getContent()) > config('sync.max_request_bytes'), 413, 'REQUEST_TOO_LARGE');
        abort_unless($r->isSecure() || (app()->environment(['local', 'testing']) && in_array($r->ip(), ['127.0.0.1', '::1'], true)), 400, 'HTTPS_REQUIRED');
        if (app()->environment('production')) {
            $host = parse_url(config('app.url'), PHP_URL_HOST);
            abort_unless($host && strcasecmp($r->getHost(), $host) === 0, 400, 'HOST_DENIED');
        }

        $response = $next($r);
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('Pragma', 'no-cache');

        return $response;
    }
}
