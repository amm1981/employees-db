<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('consumer-login', function (Request $r) {
            $username = $r->input('username');
            $key = hash('sha256', is_string($username) ? $username : '');

            return [Limit::perMinute(20)->by('ip:'.$r->ip()), Limit::perMinute(5)->by('user:'.$key)];
        });
        RateLimiter::for('consumer-read', fn (Request $r) => Limit::perMinute(120)->by($r->attributes->get('consumer')->id));
    }
}
