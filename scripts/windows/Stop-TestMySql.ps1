$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$expected = [IO.Path]::GetFullPath((Join-Path $repo '.local/mysql-test-data'))
$testServerId = [int](Get-Content -LiteralPath (Join-Path $repo '.local/mysql-test.pid'))
$proc = Get-CimInstance Win32_Process -Filter "ProcessId = $testServerId"
if (-not $proc) { Write-Host 'Dedicated test process already stopped'; exit 0 }
if ($proc.Name -ne 'mysqld.exe' -or -not $proc.CommandLine.Contains($expected) -or -not $proc.CommandLine.Contains('--port=33079')) { throw 'PID/datadir/port mismatch; refusing to stop' }
$admin = Join-Path (Split-Path $proc.ExecutablePath) 'mysqladmin.exe'
& $admin '--no-defaults' '--host=127.0.0.1' '--port=33079' '--user=root' shutdown
if ($LASTEXITCODE -ne 0) { throw 'Graceful test MySQL shutdown failed' }
Write-Host 'Dedicated test MySQL shut down; existing Wamp service unchanged.'
