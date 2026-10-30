<?php

namespace App\Sync;

final class Contract
{
    public const NAMES = ['cod_empresa', 'cod_categoria', 'cod_trabajador', 'apellido_pat', 'apellido_mat', 'Nombres', 'tipo_documento', 'email', 'sexo', 'ID_EstadoCivil', 'cod_nacionalidad', 'nacionalidad', 'tipo_trabajador', 'reloj', 'tipo_asistencia', 'Fnacimiento', 'cod_proyecto', 'area', 'area_desc', 'ccosto', 'uni_negocio', 'planilla', 'id_planilla', 'planilla_desc', 'fotocheck', 'cod_sede', 'sede', 'cod_cargo', 'cargo', 'cod_funcion', 'funcion', 'fingreso', 'fcese', 'estado', 'updpersonal', 'updagenda', 'updu'];

    public static function row(mixed $row, array $schema): void
    {
        abort_unless(is_array($row) && array_is_list($row) && count($row) === 37, 422, 'ROW_COLUMNS');
        foreach ($schema['columns'] as $i => $c) {
            $v = $row[$i];
            if ($v === null) {
                abort_unless($c['nullable'], 422, 'ROW_NULL');

                continue;
            }
            abort_unless(is_string($v), 422, 'ROW_TYPE');
            $t = strtolower($c['sqlType']);
            if (preg_match('/^(n?varchar|n?char|binary|varbinary)$/', $t) && $c['maxLength'] >= 0) {
                $size = str_starts_with($t, 'n') ? strlen(mb_convert_encoding($v, 'UTF-16LE', 'UTF-8')) : (str_contains($t, 'binary') ? strlen($v) / 2 : strlen($v));
                abort_if($size > $c['maxLength'], 422, 'ROW_SIZE');
            }
            if (in_array($t, ['int', 'bigint', 'smallint', 'tinyint'])) {
                abort_unless(preg_match('/^-?\d+$/D', $v), 422, 'ROW_INTEGER');
                [$lo, $hi] = ['tinyint' => ['0', '255'], 'smallint' => ['-32768', '32767'], 'int' => ['-2147483648', '2147483647'], 'bigint' => ['-9223372036854775808', '9223372036854775807']][$t];
                abort_unless(bccomp($v, $lo) >= 0 && bccomp($v, $hi) <= 0, 422, 'ROW_INTEGER_RANGE');
            }
            if ($t === 'bit') {
                abort_unless(in_array($v, ['0', '1'], true), 422, 'ROW_BIT');
            }
            if (in_array($t, ['decimal', 'numeric', 'money', 'smallmoney'])) {
                abort_unless(preg_match('/^-?\d+(\.\d+)?$/D', $v), 422, 'ROW_DECIMAL');
                $parts = explode('.', ltrim($v, '-'));
                abort_if(strlen($parts[1] ?? '') > $c['scale'] || strlen(ltrim($parts[0], '0')) > $c['precision'] - $c['scale'], 422, 'ROW_DECIMAL_RANGE');
            }
            if (in_array($t, ['float', 'real'])) {
                abort_unless(preg_match('/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/D', $v) && is_finite((float) $v), 422, 'ROW_FLOAT');
            }
            if (in_array($t, ['binary', 'varbinary', 'image'])) {
                abort_unless(preg_match('/^([0-9a-f]{2})*$/D', $v), 422, 'ROW_BINARY');
            }
            if ($t === 'uniqueidentifier') {
                abort_unless(preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iD', $v), 422, 'ROW_UUID');
            }
            if (in_array($t, ['date', 'datetime', 'datetime2', 'datetimeoffset', 'smalldatetime', 'time'])) {
                $pattern = $t === 'date' ? '/^\d{4}-\d{2}-\d{2}$/D' : ($t === 'time' ? '/^\d{2}:\d{2}:\d{2}(\.\d{1,7})?$/D' : ($t === 'datetimeoffset' ? '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?[+-]\d{2}:\d{2}$/D' : '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?$/D'));
                abort_unless(preg_match($pattern, $v), 422, 'ROW_DATE');
                if ($t !== 'time') {
                    [$year,$month,$day] = array_map('intval', explode('-', substr($v, 0, 10)));
                    abort_unless(checkdate($month, $day, $year), 422, 'ROW_DATE_RANGE');
                    abort_if($t === 'datetime' && $year < 1753, 422, 'ROW_DATE_RANGE');
                    abort_if($t === 'smalldatetime' && (substr($v, 0, 10) < '1900-01-01' || substr($v, 0, 10) > '2079-06-06'), 422, 'ROW_DATE_RANGE');
                }
                if ($t !== 'date') {
                    $time = $t === 'time' ? $v : substr($v, 11);
                    [$h,$m,$s] = array_map('intval', explode(':', substr($time, 0, 8)));
                    abort_if($h > 23 || $m > 59 || $s > 59, 422, 'ROW_TIME_RANGE');
                    preg_match('/\.(\d+)/', $time, $fraction);
                    abort_if(in_array($t, ['datetime2', 'time', 'datetimeoffset']) && strlen($fraction[1] ?? '') > $c['scale'], 422, 'ROW_TIME_SCALE');
                    if ($t === 'datetimeoffset') {
                        [$oh,$om] = array_map('intval', explode(':', substr($v, -5)));
                        abort_if($oh > 14 || $om > 59 || ($oh === 14 && $om !== 0), 422, 'ROW_OFFSET');
                    }
                }
            }
        }
    }
}
