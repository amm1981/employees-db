<?php

namespace App\Sync;

final class SqlEncoding
{
    public static function varcharBytes(string $value, ?string $collation): int
    {
        if (! in_array($collation, ['SQL_Latin1_General_CP1_CI_AS', 'Modern_Spanish_CI_AS'], true)) {
            return strlen($value);
        }
        abort_unless(preg_match('/^[\x{0000}-\x{007F}\x{00A0}-\x{00FF}\x{0081}\x{008D}\x{008F}\x{0090}\x{009D}€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/uD', $value), 422, 'ROW_ENCODING');

        return mb_strlen($value, 'UTF-8');
    }
}
