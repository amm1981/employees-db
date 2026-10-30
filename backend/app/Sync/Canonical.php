<?php

namespace App\Sync;

final class Canonical
{
    public static function encode(mixed $v): string
    {
        if (is_array($v)) {
            if (array_is_list($v)) {
                return '['.implode(',', array_map(self::encode(...), $v)).']';
            }
            ksort($v, SORT_STRING);

            return '{'.implode(',', array_map(fn ($k) => self::encode((string) $k).':'.self::encode($v[$k]), array_keys($v))).'}';
        }

        return json_encode($v, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS);
    }

    public static function hash(mixed $v): string
    {
        return hash('sha256', self::encode($v));
    }
}
