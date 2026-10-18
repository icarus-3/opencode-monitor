$ErrorActionPreference='Stop'
$manifest=Get-Content "$PSScriptRoot\data\installed-plugins.json" -Raw | ConvertFrom-Json
foreach($file in $manifest){
  if(Test-Path $file){
    $text=Get-Content $file -Raw
    if($text.Contains('opencode-monitor') -and $text.Contains('MonitorTray.exe')){Remove-Item -LiteralPath $file}
  }
}
Write-Host 'OpenCode auto-start hooks removed. Monitor data and backups retained. Use stop.cmd to stop monitoring.'
