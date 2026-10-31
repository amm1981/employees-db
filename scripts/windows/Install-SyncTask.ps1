param(
  [ValidateSet('casablanca-altas-bajas','diamond-bridge-altas-bajas')][string]$Integration = 'casablanca-altas-bajas',
  [switch]$Register,
  [switch]$Update
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$node = (Get-Command node.exe).Source
$cfg = & $node (Join-Path $PSScriptRoot 'task-config.mjs') $Integration | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Build and validate first' }
if (-not $cfg.enabled) { throw 'Integration is disabled; no task will be prepared or registered' }
if ($Update -and -not $Register) { throw '-Update requires -Register' }
if (-not $cfg.readiness.ready) {
  Write-Warning ("Scheduled checks can run, but SQL synchronization is blocked: " + ($cfg.readiness.blockers -join ', '))
}
$taskName = "GET-Employes-$Integration"
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$safeRepo = [Security.SecurityElement]::Escape($repo)
$safeNode = [Security.SecurityElement]::Escape($node)
$runner = [Security.SecurityElement]::Escape((Join-Path $PSScriptRoot 'Run-Sync.ps1'))
$safeAccount = [Security.SecurityElement]::Escape($account)
$powershell = [Security.SecurityElement]::Escape((Join-Path $PSHOME 'powershell.exe'))
if (-not (Test-Path -LiteralPath (Join-Path $PSHOME 'powershell.exe'))) { $powershell = [Security.SecurityElement]::Escape((Join-Path $PSHOME 'pwsh.exe')) }
# Offset pins Lima (-05:00), independent from the Windows machine's display timezone.
$start = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(-5)).AddMinutes(1).ToString("yyyy-MM-ddTHH:mm:sszzz")
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>GET-Employes $Integration; America/Lima</Description></RegistrationInfo>
 <Triggers><TimeTrigger><Repetition><Interval>PT$($cfg.everyMinutes)M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$start</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
 <Principals><Principal id="Author"><UserId>$safeAccount</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT$($cfg.maxMinutes)M</ExecutionTimeLimit></Settings>
 <Actions Context="Author"><Exec><Command>$powershell</Command><Arguments>-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File &quot;$runner&quot; -Integration $Integration -NodePath &quot;$safeNode&quot;</Arguments><WorkingDirectory>$safeRepo</WorkingDirectory></Exec></Actions>
</Task>
"@
$out = Join-Path $repo ".local/$taskName.xml"
New-Item -ItemType Directory -Path (Split-Path $out) -Force | Out-Null
$xml | Set-Content -LiteralPath $out -Encoding Unicode
if ($Register) {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing) {
    if (-not $Update) { throw 'Task already exists; use -Register -Update to apply the current schedule' }
    $existingActions = @($existing.Actions)
    $expectedRunner = Join-Path $PSScriptRoot 'Run-Sync.ps1'
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $shortAccount = ($account -split '\\')[-1]
    if ($existingActions.Count -ne 1 -or -not $existingActions[0].Arguments.Contains(('"' + $expectedRunner + '"')) -or $existingActions[0].WorkingDirectory -ne $repo -or $existing.Principal.UserId -notin @($account, $currentSid, $shortAccount)) {
      throw 'Existing task does not belong to this workspace/account; refusing replacement'
    }
    Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Xml $xml -Force | Out-Null
  } else {
    Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Xml $xml | Out-Null
  }
  Write-Host "Task registered: $taskName; every $($cfg.everyMinutes) minutes; readiness=$($cfg.readiness.ready)"
} else { Write-Host "Review XML: $out. No task registered. -Register is an explicit future operator action." }
