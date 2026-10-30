<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

final class CreateConsumer extends Command
{
    protected $signature = 'consumer:create {username} {--dataset=*} {--password-env=API_CONSUMER_PASSWORD} {--simulation}';

    protected $description = 'Create a read-only API consumer; password comes from a hidden prompt or environment';

    public function handle(): int
    {
        $username = $this->argument('username');
        $datasets = array_values(array_unique($this->option('dataset')));
        if (! preg_match('/^[a-z0-9][a-z0-9._-]{0,79}$/D', $username) || ! $datasets || count($datasets) > 100 || DB::table('integrations')->whereIn('id', $datasets)->count() !== count($datasets)) {
            $this->error('USERNAME_OR_DATASETS_INVALID');

            return self::FAILURE;
        }
        if (DB::table('api_consumers')->where('username', $username)->exists()) {
            $this->error('CONSUMER_EXISTS');

            return self::FAILURE;
        }
        $simulation = (bool) $this->option('simulation');
        if ($simulation && (! config('sync.allow_fixtures') || ! app()->environment(['local', 'testing']))) {
            $this->error('FIXTURES_DISABLED');

            return self::FAILURE;
        }
        $envName = $this->option('password-env');
        $password = is_string($envName) && preg_match('/^[A-Z_][A-Z0-9_]*$/D', $envName) ? getenv($envName) : false;
        if ($password === false && $this->input->isInteractive()) {
            $password = $this->secret('Password (16–72 bytes)');
        }
        if (! is_string($password) || strlen($password) < 16 || strlen($password) > 72) {
            $this->error('PASSWORD_MUST_BE_16_TO_72_BYTES');

            return self::FAILURE;
        }
        $id = (string) Str::uuid();
        DB::transaction(function () use ($id, $username, $password, $datasets, $simulation) {
            DB::table('api_consumers')->insert(['id' => $id, 'username' => $username, 'password' => Hash::make($password), 'integrations' => json_encode($datasets), 'simulation' => $simulation, 'enabled' => true, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('audit_events')->insert(['action' => 'consumer.created', 'details' => json_encode(['consumerId' => $id]), 'created_at' => now()]);
        });
        $this->info('Consumer created: '.$id);

        return self::SUCCESS;
    }
}
