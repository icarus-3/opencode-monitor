$ErrorActionPreference='Stop'
$pidFile=Join-Path $PSScriptRoot 'data\window-hook.pid'
if(Test-Path -LiteralPath $pidFile){
  $hook=Get-Process -Id ([int](Get-Content -LiteralPath $pidFile -Raw)) -ErrorAction SilentlyContinue
  $expected=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'data\window-hook')).TrimEnd('\')+'\'
  if($hook -and $hook.Path -and $hook.Path.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)){$hook.Kill();$hook.WaitForExit()}
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
$manifest=Get-Content "$PSScriptRoot\data\installed-plugins.json" -Raw | ConvertFrom-Json
foreach($file in $manifest){
  if(Test-Path $file){
    $text=Get-Content $file -Raw
    if($text.Contains('opencode-monitor') -and $text.Contains('MonitorTray.exe')){Remove-Item -LiteralPath $file}
  }
}
Write-Host 'OpenCode auto-start hooks removed. Monitor data and backups retained. Use stop.cmd to stop monitoring.'
