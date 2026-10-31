param([string]$Integration = 'diamond-bridge-altas-bajas')
$ErrorActionPreference = 'Stop'
$name = "GET-Employes-$Integration"
$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if (-not $task) { Write-Host "Not registered: $name"; exit 0 }
# Explicit formatting keeps PowerShell from rendering subsequent objects with
# the first object's table columns, which hid task results and readiness.
$task | Format-List TaskName,State,Principal,Settings
Get-ScheduledTaskInfo -TaskName $name | Format-List LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns
$node = (Get-Command node.exe).Source
$cfg = & $node (Join-Path $PSScriptRoot 'task-config.mjs') $Integration | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read current task configuration' }
[pscustomobject]@{ EveryMinutes=$cfg.everyMinutes; Ready=$cfg.readiness.ready; Blockers=($cfg.readiness.blockers -join ', ') } | Format-List
