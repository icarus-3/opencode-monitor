param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference='Stop'
& node.exe (Join-Path $PSScriptRoot 'update-local.mjs') $InstallDir
if($LASTEXITCODE -ne 0){throw 'Local update failed'}
