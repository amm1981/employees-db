param()
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeMajor = & $node -p "process.versions.node.split('.')[0]"
if ($LASTEXITCODE -ne 0 -or $nodeMajor -ne '24') { throw 'Node.js 24 LTS is required for the Windows agent' }
$localDir = Join-Path $repo '.local'
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $localDir '/inheritance:r' '/grant:r' "${account}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the local agent directory' }
& $node (Join-Path $PSScriptRoot 'initialize-agent.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Agent initialization failed' }
& icacls (Join-Path $repo '.env') '/inheritance:r' '/grant:r' "${account}:F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the agent .env' }
Write-Host 'Agent initialized. No PHP/MySQL setup, SQL queries, HTTP transfers or tasks were started.'
