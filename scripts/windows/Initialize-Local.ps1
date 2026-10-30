param([string]$PhpPath = 'php.exe', [switch]$Fixtures)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $repo
$local = Join-Path $repo '.local'
New-Item -ItemType Directory -Path $local -Force | Out-Null
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $local '/inheritance:r' '/grant:r' "${account}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ACL failed' }
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
  $key = & node.exe --input-type=module -e 'import {randomBytes} from "node:crypto";process.stdout.write(randomBytes(32).toString("base64"))'
  (Get-Content -LiteralPath '.env' -Raw).Replace('SPOOL_KEY=', "SPOOL_KEY=$key") | Set-Content -LiteralPath '.env' -Encoding UTF8
  & icacls (Join-Path $repo '.env') '/inheritance:r' '/grant:r' "${account}:F" | Out-Null
}
if (-not (Test-Path -LiteralPath 'backend/.env')) {
  Copy-Item -LiteralPath 'backend/.env.example' -Destination 'backend/.env'
  Push-Location -LiteralPath (Join-Path $repo 'backend')
  try { & $PhpPath artisan key:generate --no-interaction; if ($LASTEXITCODE -ne 0) { throw 'Key generation failed' } } finally { Pop-Location }
  & icacls (Join-Path $repo 'backend/.env') '/inheritance:r' '/grant:r' "${account}:F" | Out-Null
}
if ($Fixtures) {
  $file = Join-Path $local 'fixture-tokens.json'
  if (-not (Test-Path -LiteralPath $file)) {
    & node.exe --input-type=module -e 'import {randomBytes} from "node:crypto";import {writeFileSync} from "node:fs";writeFileSync(".local/fixture-tokens.json",JSON.stringify(Object.fromEntries(["ingestToken","readToken","opsToken"].map(k=>[k,randomBytes(32).toString("hex")]))),{flag:"wx",mode:384})'
    if ($LASTEXITCODE -ne 0) { throw 'Token generation failed' }
  }
  $db = Join-Path $local 'dev.sqlite'
  if (-not (Test-Path -LiteralPath $db)) { New-Item -ItemType File -Path $db | Out-Null }
  $backendEnv = Get-Content -LiteralPath 'backend/.env' -Raw
  $backendEnv = $backendEnv -replace '(?m)^DB_CONNECTION=.*$', 'DB_CONNECTION=sqlite'
  $backendEnv = $backendEnv -replace '(?m)^DB_DATABASE=.*$', ("DB_DATABASE=" + $db.Replace('\','/'))
  $backendEnv = $backendEnv -replace '(?m)^SYNC_ALLOW_FIXTURES=.*$', 'SYNC_ALLOW_FIXTURES=true'
  $backendEnv | Set-Content -LiteralPath 'backend/.env' -Encoding UTF8
  Push-Location -LiteralPath (Join-Path $repo 'backend')
  try {
    & $PhpPath artisan migrate --no-interaction; if ($LASTEXITCODE -ne 0) { throw 'Local migrations failed' }
    & $PhpPath artisan fixtures:setup "--secrets-file=$file"; if ($LASTEXITCODE -ne 0) { throw 'Fixture setup failed' }
  } finally { Pop-Location }
  $tokens = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
  $agentEnv = Get-Content -LiteralPath '.env' -Raw
  $agentEnv = $agentEnv -replace '(?m)^API_BASE_URL=.*$', 'API_BASE_URL=http://127.0.0.1:8000'
  $agentEnv = $agentEnv -replace '(?m)^API_INGEST_TOKEN=.*$', ("API_INGEST_TOKEN=" + $tokens.ingestToken)
  $agentEnv = $agentEnv -replace '(?m)^AGENT_ORIGIN=.*$', 'AGENT_ORIGIN=fixture-agent'
  $agentEnv | Set-Content -LiteralPath '.env' -Encoding UTF8
}
Write-Host 'Local configuration ready; secrets were not printed. No services or scheduled tasks registered.'
