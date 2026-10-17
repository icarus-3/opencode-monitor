$ErrorActionPreference = 'Stop'
$monitorRoot = $PSScriptRoot
$monitorConfig = Get-Content -LiteralPath (Join-Path $monitorRoot 'config.json') -Raw | ConvertFrom-Json
$monitorUrl = "http://127.0.0.1:$($monitorConfig.port)"
$monitorServer = Join-Path $monitorRoot 'server.mjs'
$monitorPidFile = Join-Path $monitorRoot 'data\server.pid'
$runningMonitor = $null
if (Test-Path -LiteralPath $monitorPidFile) {
  $monitorProcessId = (Get-Content -LiteralPath $monitorPidFile -Raw).Trim()
  if ($monitorProcessId -match '^\d+$') {
    $runningMonitor = Get-CimInstance Win32_Process -Filter "ProcessId=$monitorProcessId" | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine.Contains($monitorServer) }
  }
}
if (-not $runningMonitor) {
  $monitorNode = Join-Path $monitorRoot 'runtime\node.exe'
  if (-not (Test-Path -LiteralPath $monitorNode)) { $monitorNode = (Get-Command node.exe -ErrorAction Stop).Source }
  if ([int]((& $monitorNode -p 'parseInt(process.versions.node)')) -lt 24) { throw 'Node.js 24 or later is required.' }
  New-Item -ItemType Directory -Force -Path (Join-Path $monitorRoot 'data') | Out-Null
  $runningMonitor = Start-Process -FilePath $monitorNode -ArgumentList @('"' + $monitorServer + '"') -WorkingDirectory $monitorRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $monitorRoot 'data\server.log') -RedirectStandardError (Join-Path $monitorRoot 'data\server-error.log') -PassThru
}
$monitorReady = $false
for ($monitorAttempt = 0; $monitorAttempt -lt 60; $monitorAttempt++) {
  try { $monitorResponse = Invoke-WebRequest "$monitorUrl/api/dashboard" -UseBasicParsing -TimeoutSec 2; if ($monitorResponse.StatusCode -eq 200) { $monitorReady = $true; break } } catch {}
  Start-Sleep -Milliseconds 500
}
if (-not $monitorReady) { throw "Monitor did not become ready. See $monitorRoot\data\server-error.log" }
Write-Host "OpenCode Monitor: $monitorUrl"
Start-Process $monitorUrl
