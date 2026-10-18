$ErrorActionPreference='Stop'
$configFile=Join-Path $PSScriptRoot 'config.json'
if(-not(Test-Path $configFile)){$configFile=Join-Path $PSScriptRoot 'config.example.json'}
$cfg=Get-Content $configFile -Raw | ConvertFrom-Json
$tokenFile=Join-Path $PSScriptRoot 'data\control.token'
if(-not(Test-Path $tokenFile)){Write-Host 'Monitor is already stopped.';exit 0}
try{$health=Invoke-RestMethod -Uri "http://127.0.0.1:$($cfg.port)/api/health" -TimeoutSec 3}
catch [Net.WebException]{if($_.Exception.Status -eq [Net.WebExceptionStatus]::ConnectFailure){Write-Host 'Monitor is already stopped.';exit 0};throw}
if($health.app -ne 'opencode-monitor' -or [IO.Path]::GetFullPath($health.root) -ne [IO.Path]::GetFullPath($PSScriptRoot)){throw 'Port belongs to another application or installation; refusing to stop it.'}
$token=Get-Content $tokenFile -Raw
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($cfg.port)/api/shutdown" -Headers @{Authorization="Bearer $($token.Trim())"} -TimeoutSec 5 | Out-Null
