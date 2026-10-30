param(
  [Parameter(Mandatory=$true)][ValidateSet('casablanca-altas-bajas','diamond-bridge-altas-bajas')][string]$Integration,
  [string]$NodePath = 'node.exe'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $repo
$logDir = Join-Path $repo '.local/logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
# Recover sealed pending runs first; failure stops this integration before a fresh SQL query.
& $NodePath (Join-Path $repo 'agent/dist/cli.js') recover --integration $Integration --publish *>> (Join-Path $logDir "$Integration-$stamp.jsonl")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $NodePath (Join-Path $repo 'agent/dist/cli.js') sync --integration $Integration --allow-sql --send --publish *>> (Join-Path $logDir "$Integration-$stamp.jsonl")
exit $LASTEXITCODE
