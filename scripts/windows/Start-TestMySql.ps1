param(
  [Parameter(Mandatory=$true)][string]$MySqlD,
  [int]$Port = 33079
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$localDir = Join-Path $repo '.local'
$dataDir = [IO.Path]::GetFullPath((Join-Path $localDir 'mysql-test-data'))
if (-not $dataDir.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Datadir outside workspace' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw 'Test port already occupied' }
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$principal = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $localDir '/inheritance:r' '/grant:r' "${principal}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ACL failed' }
if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'mysql'))) {
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  & $MySqlD '--no-defaults' '--initialize-insecure' "--datadir=$dataDir" '--console'
  if ($LASTEXITCODE -ne 0) { throw 'MySQL test initialization failed' }
}
$arguments = @('--no-defaults', ('--datadir="' + $dataDir + '"'), "--port=$Port", '--bind-address=127.0.0.1', '--mysqlx=0', '--skip-log-bin', '--innodb-buffer-pool-size=64M', '--console')
$proc = Start-Process -FilePath $MySqlD -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $localDir 'mysql-test.stdout.log') -RedirectStandardError (Join-Path $localDir 'mysql-test.stderr.log')
$proc.Id | Set-Content -LiteralPath (Join-Path $localDir 'mysql-test.pid')
Write-Host "Isolated fixture MySQL PID $($proc.Id), 127.0.0.1:$Port. Stop only this PID after tests. No Windows service registered."
