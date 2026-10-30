<?php

use App\Http\Middleware\ServiceToken;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->remove([TrimStrings::class, ConvertEmptyStringsToNull::class]);
        $middleware->alias(['service.token' => ServiceToken::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn ($r) => $r->is('api/*') || $r->expectsJson());
        $exceptions->render(function (Throwable $e, Request $r) {
            if (! $r->is('api/*')) {
                return null;
            }
            $status = $e instanceof ValidationException ? 422 : ($e instanceof HttpExceptionInterface ? $e->getStatusCode() : 500);
            $message = preg_match('/^[A-Z][A-Z0-9_]+$/', $e->getMessage()) ? $e->getMessage() : ($status === 422 ? 'VALIDATION_FAILED' : 'REQUEST_FAILED');

            return response()->json(['error' => ['code' => $message]], $status);
        });
        $exceptions->report(function (Throwable $e) {
            if (request()->is('api/*')) {
                Log::error('api_failure', ['exception_type' => get_class($e)]);

                return false;
            }
        });
    })->create();
