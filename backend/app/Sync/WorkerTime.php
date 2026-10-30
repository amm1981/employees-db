<?php

namespace App\Sync;

use DateTimeImmutable;
use DateTimeZone;

final class WorkerTime
{
    public static function latest(array $row, array $schema): ?string
    {
        $latest = null;
        $zone = new DateTimeZone(config('consumer.source_timezone'));
        foreach ($schema['columns'] as $n => $column) {
            if (! in_array($column['name'], ['updpersonal', 'updagenda', 'updu'], true) || $row[$n] === null) {
                continue;
            }
            $value = $row[$n];
            abort_unless(in_array(strtolower($column['sqlType']), ['datetime', 'datetime2', 'datetimeoffset', 'smalldatetime'], true) && preg_match('/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?([+-]\d{2}:\d{2})?$/D', $value, $parts), 422, 'WORKER_CHANGE_DATE_INVALID');
            $sourceZone = isset($parts[3]) && $parts[3] !== '' ? new DateTimeZone($parts[3]) : $zone;
            $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s', $parts[1], $sourceZone);
            abort_unless($date && $date->format('Y-m-d\TH:i:s') === $parts[1], 422, 'WORKER_CHANGE_DATE_INVALID');
            // Convert whole seconds only; retain the original seventh fractional digit.
            $utc = $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s').'.'.str_pad($parts[2] ?? '', 7, '0');
            $latest = $latest === null || $utc > $latest ? $utc : $latest;
        }

        return $latest;
    }
}
