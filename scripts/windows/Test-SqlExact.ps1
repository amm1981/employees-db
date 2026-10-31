param([switch]$EmitFixture)
$ErrorActionPreference = 'Stop'
Add-Type -Path @((Join-Path $PSScriptRoot 'SqlExactReader.cs'), (Join-Path $PSScriptRoot 'SqlExactReaderTests.cs')) -ReferencedAssemblies System.Data,System.Web.Extensions,System.Xml
[GetEmployes.SqlExactReaderTests]::Run()
$invariant = [Globalization.CultureInfo]::InvariantCulture
$originalCulture = [Threading.Thread]::CurrentThread.CurrentCulture
try {
    [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo('fr-FR')
    foreach ($decimal in @('999999999999999999', '12345678901234567890.123456789012345678', '-99999999999999999999999999999999999999')) {
        $actual = [GetEmployes.SqlExactReader]::Format([System.Data.SqlTypes.SqlDecimal]::Parse($decimal), 'numeric', 18)
        if ($actual -ne $decimal) { throw 'DECIMAL_ROUNDTRIP_FAILED' }
    }
    for ($tick = 0; $tick -lt 300; $tick++) {
        $sqlDate = [System.Data.SqlTypes.SqlDateTime]::new(0, $tick)
        $text = [GetEmployes.SqlExactReader]::Format($sqlDate.Value, 'datetime', 3)
        $restored = [System.Data.SqlTypes.SqlDateTime]::new([DateTime]::ParseExact($text, "yyyy-MM-dd'T'HH:mm:ss.fff", $invariant))
        if ($restored.DayTicks -ne $sqlDate.DayTicks -or $restored.TimeTicks -ne $sqlDate.TimeTicks) { throw 'DATETIME_ROUNDTRIP_FAILED' }
    }
    $date = [DateTime]::new(2026,10,31,12,1,2).AddTicks(1234567)
    if ([GetEmployes.SqlExactReader]::Format($date, 'datetime2', 7) -ne '2026-10-31T12:01:02.1234567') { throw 'DATETIME2_PRECISION_FAILED' }
    $offset = [DateTimeOffset]::new($date, [TimeSpan]::FromHours(-5))
    if ([GetEmployes.SqlExactReader]::Format($offset, 'datetimeoffset', 7) -ne '2026-10-31T12:01:02.1234567-05:00') { throw 'OFFSET_ROUNDTRIP_FAILED' }
    if ([GetEmployes.SqlExactReader]::Format([TimeSpan]::FromSeconds(3).Add([TimeSpan]::FromTicks(1234567)), 'time', 7) -ne '00:00:03.1234567') { throw 'TIME_PRECISION_FAILED' }
    foreach ($collation in @('SQL_Latin1_General_CP1_CI_AS', 'Modern_Spanish_CI_AS')) {
        $column = [GetEmployes.ExactColumn]::new()
        $column.sqlType = 'varchar'; $column.collation = $collation; $column.maxLength = 30
        $sample = 'Ficticio ' + [char]0xF1 + [char]0xE1 + ' ' + [char]0x20AC + ' ' + [char]0x2014
        [GetEmployes.SqlExactReader]::ValidateText($sample, $column)
        $cp1252 = [Text.Encoding]::GetEncoding(1252)
        for ($code = 0; $code -lt 256; $code++) {
            $character = $cp1252.GetString([byte[]]@($code))
            [GetEmployes.SqlExactReader]::ValidateText($character, $column)
        }
    }
    if (-not $EmitFixture) { Write-Output 'PASS: sequential text/binary reads, row bounds, sanitized failures, SQL numeric(38), all 300 datetime ticks, datetime2/time(7), offsets and CP1252; no SQL connection opened.' }
} finally {
    [Threading.Thread]::CurrentThread.CurrentCulture = $originalCulture
}
if ($EmitFixture) {
    # Synthetic protocol sample only. This script never opens a SQL connection.
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false, $true)
    $schema = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../contracts/schemas/casablanca.reviewed-v1.json') -Raw -Encoding UTF8 | ConvertFrom-Json).schema
    $row = [object[]]::new(37)
    for ($index = 0; $index -lt 37; $index++) {
        $column = $schema.columns[$index]
        if ($column.nullable) { continue }
        $row[$index] = switch ($column.sqlType) {
            'int' { '1' }
            'numeric' { [GetEmployes.SqlExactReader]::Format([System.Data.SqlTypes.SqlDecimal]::Parse('999999999999999999'), 'numeric', 0) }
            'datetime' { [GetEmployes.SqlExactReader]::Format([DateTime]::new(1990,1,2), 'datetime', 3) }
            default { 'A' }
        }
    }
    $row[2] = '00001234'
    $row[5] = 'Ficticio ' + [char]0xF1 + [char]0xE1 + ' ' + [char]0x20AC
    $row[34] = [GetEmployes.SqlExactReader]::Format([System.Data.SqlTypes.SqlDateTime]::new([DateTime]::UtcNow).Value, 'datetime', 3)
    $json = [System.Web.Script.Serialization.JavaScriptSerializer]::new()
    [Console]::Out.WriteLine('{"kind":"ready"}')
    $frame = $json.Serialize(@{ kind='row'; values=$row })
    [Console]::Out.WriteLine($frame)
    [Console]::Out.WriteLine($frame)
    [Console]::Out.WriteLine('{"kind":"complete","count":2}')
}
