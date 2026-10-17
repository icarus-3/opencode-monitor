param(
  [Parameter(Mandatory=$true)][string]$NodeExecutable,
  [Parameter(Mandatory=$true)][string]$NodeLicense,
  [string]$Destination = (Join-Path (Split-Path $PSScriptRoot -Parent) 'dist')
)
$ErrorActionPreference = 'Stop'
$monitorRoot = Split-Path $PSScriptRoot -Parent
$monitorVersion = (& $NodeExecutable -p 'process.versions.node').Trim()
$monitorArch = (& $NodeExecutable -p 'process.arch').Trim()
$monitorPlatform = (& $NodeExecutable -p 'process.platform').Trim()
if ([int]($monitorVersion.Split('.')[0]) -lt 24 -or $monitorArch -ne 'x64' -or $monitorPlatform -ne 'win32') { throw 'A Windows x64 Node.js 24+ executable is required.' }
if (-not (Test-Path -LiteralPath $NodeLicense)) { throw 'Supply the official LICENSE for this Node version.' }
$monitorStage = Join-Path $Destination 'opencode-monitor'
if (Test-Path -LiteralPath $monitorStage) { throw "Build directory already exists: $monitorStage. Choose a fresh Destination." }
New-Item -ItemType Directory -Force -Path $monitorStage | Out-Null
$monitorFiles = @('public','seed','config.json','discover.mjs','metrics.mjs','store.mjs','server.mjs','package.json','test.mjs','README.md','LICENSE','start.cmd','start.ps1','stop.cmd','stop.ps1')
foreach ($monitorFile in $monitorFiles) { Copy-Item -LiteralPath (Join-Path $monitorRoot $monitorFile) -Destination $monitorStage -Recurse }
New-Item -ItemType Directory -Path (Join-Path $monitorStage 'runtime') | Out-Null
Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $monitorStage 'runtime\node.exe')
Copy-Item -LiteralPath $NodeLicense -Destination (Join-Path $monitorStage 'runtime\LICENSE-node.txt')
Set-Content -LiteralPath (Join-Path $monitorStage 'runtime\VERSION.txt') -Value "Node.js $monitorVersion win-x64" -Encoding ASCII
$monitorZip = Join-Path $Destination 'opencode-monitor-windows-x64.zip'
Compress-Archive -LiteralPath $monitorStage -DestinationPath $monitorZip -CompressionLevel Optimal
$monitorHash = (Get-FileHash -LiteralPath $monitorZip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $Destination 'SHA256SUMS.txt') -Value "$monitorHash  opencode-monitor-windows-x64.zip" -Encoding ASCII
Write-Host "Built $monitorZip"
