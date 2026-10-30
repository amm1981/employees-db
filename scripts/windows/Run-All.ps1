param([string]$NodePath = 'node.exe')
$failed = $false
foreach ($integration in @('casablanca-altas-bajas','diamond-bridge-altas-bajas')) {
  & (Join-Path $PSScriptRoot 'Run-Sync.ps1') -Integration $integration -NodePath $NodePath
  if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Warning "Integration stopped: $integration. Continuing with independent integrations." }
}
if ($failed) { exit 1 }
