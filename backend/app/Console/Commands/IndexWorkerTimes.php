<?php

namespace App\Console\Commands;

use App\Sync\WorkerTime;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

final class IndexWorkerTimes extends Command
{
    protected $signature = 'workers:index';

    protected $description = 'Index modification times of existing encrypted captures without querying SQL Server';

    public function handle(): int
    {
        $last = 0;
        $count = 0;
        $zone = config('consumer.source_timezone');
        do {
            $rows = DB::table('staging_records as s')->join('sync_runs as r', 'r.id', '=', 's.run_id')->join('integration_schemas as c', 'c.id', '=', 'r.schema_id')->where('s.id', '>', $last)->where(fn ($q) => $q->whereNull('s.worker_time_zone')->orWhere('s.worker_time_zone', '<>', $zone))->orderBy('s.id')->limit(500)->get(['s.id', 's.payload', 's.hash', 'c.document']);
            DB::transaction(function () use ($rows, &$last, &$count, $zone) {
                foreach ($rows as $row) {
                    $plain = Crypt::decryptString($row->payload);
                    abort_unless(hash_equals($row->hash, hash('sha256', $plain)), 409, 'ROW_INTEGRITY');
                    $changed = WorkerTime::latest(json_decode($plain, true, 512, JSON_THROW_ON_ERROR), json_decode($row->document, true, 512, JSON_THROW_ON_ERROR));
                    DB::table('staging_records')->where('id', $row->id)->update(['worker_changed_at' => $changed, 'worker_time_zone' => $zone]);
                    $last = $row->id;
                    $count++;
                }
            });
        } while ($rows->count() === 500);
        $this->info('Worker times indexed: '.$count);

        return self::SUCCESS;
    }
}
