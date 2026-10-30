param([string]$Integration = 'casablanca-altas-bajas')
$ErrorActionPreference = 'Stop'
$name = "GET-Employes-$Integration"
$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if (-not $task) { Write-Host "Not registered: $name"; exit 0 }
$task | Select-Object TaskName,State,Principal,Settings
Get-ScheduledTaskInfo -TaskName $name | Select-Object LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns
