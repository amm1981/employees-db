param(
  [Parameter(Mandatory=$true)][ValidateSet('casablanca-altas-bajas','diamond-bridge-altas-bajas')][string]$Integration,
  [string]$NodePath = 'node.exe'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $repo
$logDir = Join-Path $repo '.local/logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$logFile = Join-Path $logDir "$Integration-$stamp.jsonl"
# Report every blocking condition without opening SQL or sending HTTP requests.
& $NodePath (Join-Path $repo 'agent/dist/cli.js') preflight --integration $Integration *>> $logFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# Recover sealed pending runs first; failure stops this integration before a fresh SQL query.
& $NodePath (Join-Path $repo 'agent/dist/cli.js') recover --integration $Integration --publish *>> $logFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $NodePath (Join-Path $repo 'agent/dist/cli.js') sync --integration $Integration --allow-sql --send --publish *>> $logFile
exit $LASTEXITCODE
