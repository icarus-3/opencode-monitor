$ErrorActionPreference='Stop'
$cfg=Get-Content "$PSScriptRoot\config.json" -Raw | ConvertFrom-Json
$token=Get-Content "$PSScriptRoot\data\control.token" -Raw
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($cfg.port)/api/shutdown" -Headers @{Authorization="Bearer $($token.Trim())"} | Out-Null
