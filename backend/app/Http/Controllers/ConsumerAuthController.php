<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

final class ConsumerAuthController extends Controller
{
    public function login(Request $r)
    {
        abort_unless($r->isJson(), 415, 'JSON_REQUIRED');
        abort_if($r->query() || array_diff(array_keys($r->json()->all()), ['username', 'password']), 422, 'LOGIN_BODY_REQUIRED');
        $v = $r->validate(['username' => ['required', 'string', 'max:80', 'regex:/^[a-z0-9][a-z0-9._-]*$/D'], 'password' => 'required|string|max:256']);
        abort_if(strlen($v['password']) > 72, 401, 'INVALID_CREDENTIALS');
        $consumer = DB::table('api_consumers')->where('username', $v['username'])->first();
        // Valid bcrypt hash also performs the password work for unknown usernames.
        $valid = Hash::check($v['password'], $consumer->password ?? '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.');
        abort_unless($valid && $consumer && $consumer->enabled, 401, 'INVALID_CREDENTIALS');
        abort_if($consumer->simulation && (! config('sync.allow_fixtures') || ! app()->environment(['local', 'testing'])), 401, 'INVALID_CREDENTIALS');
        $ttl = config('consumer.token_ttl_minutes');
        abort_unless($ttl >= 1 && $ttl <= 1440, 500, 'TOKEN_TTL_INVALID');

        return DB::transaction(function () use ($consumer, $ttl) {
            $locked = DB::table('api_consumers')->where('id', $consumer->id)->lockForUpdate()->first();
            abort_unless($locked && $locked->enabled && hash_equals($consumer->password, $locked->password), 401, 'INVALID_CREDENTIALS');
            $raw = bin2hex(random_bytes(32));
            $id = (string) Str::uuid();
            $expires = now()->addMinutes($ttl);
            // Bound concurrent sessions; revoke the oldest before issuing session 11.
            $old = DB::table('consumer_access_tokens')->where('consumer_id', $consumer->id)->whereNull('revoked_at')->where('expires_at', '>', now())->orderByDesc('created_at')->orderByDesc('id')->skip(9)->take(1000)->pluck('id');
            if ($old->isNotEmpty()) {
                DB::table('consumer_access_tokens')->whereIn('id', $old)->update(['revoked_at' => now()]);
            }
            DB::table('consumer_access_tokens')->insert(['id' => $id, 'consumer_id' => $consumer->id, 'hash' => hash('sha256', $raw), 'expires_at' => $expires, 'created_at' => now()]);
            DB::table('audit_events')->insert(['action' => 'consumer.login', 'token_id' => $id, 'details' => json_encode(['consumerId' => $consumer->id]), 'created_at' => now()]);

            return response()->json(['access_token' => $raw, 'token_type' => 'Bearer', 'expires_in' => $ttl * 60, 'expires_at' => $expires->toIso8601String()]);
        }, 5);
    }

    public function logout(Request $r)
    {
        $token = $r->attributes->get('consumer_token');
        DB::table('consumer_access_tokens')->where('id', $token->id)->update(['revoked_at' => now()]);
        DB::table('audit_events')->insert(['action' => 'consumer.logout', 'token_id' => $token->id, 'created_at' => now()]);

        return response()->noContent();
    }
}
