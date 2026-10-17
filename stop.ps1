$ErrorActionPreference = 'Stop'
$monitorPidFile = Join-Path $PSScriptRoot 'data\server.pid'
if (-not (Test-Path -LiteralPath $monitorPidFile)) { Write-Host 'Monitor is already stopped.'; exit 0 }
$monitorProcessId = (Get-Content -LiteralPath $monitorPidFile -Raw).Trim()
if ($monitorProcessId -notmatch '^\d+$') { throw 'Invalid monitor PID file.' }
$monitorProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$monitorProcessId"
if ($monitorProcess) {
  $monitorServer = Join-Path $PSScriptRoot 'server.mjs'
  if ($monitorProcess.Name -ne 'node.exe' -or -not $monitorProcess.CommandLine.Contains($monitorServer)) { throw 'PID belongs to another process; refusing to stop it.' }
  Stop-Process -Id ([int]$monitorProcessId)
}
Remove-Item -LiteralPath $monitorPidFile
Write-Host 'OpenCode Monitor stopped. OpenCode was not stopped.'
