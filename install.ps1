param([string]$InstallDir=(Join-Path $env:LOCALAPPDATA 'OpenCodeMonitor'),[string]$LegacyRoot,[string[]]$PluginDirectories=@(),[switch]$SkipDefaultPluginDirectories,[switch]$NoStart)
$ErrorActionPreference='Stop'
$monitorNode=(Get-Command node.exe -ErrorAction Stop).Source
if([int](& $monitorNode -p 'parseInt(process.versions.node)') -lt 24){throw 'Node 24+ required'}
if(-not (Test-Path "$PSScriptRoot\MonitorTray.exe")){throw 'Missing tray executable; run build.ps1 first'}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
if((Resolve-Path $InstallDir).Path -ne $PSScriptRoot){
  if(Test-Path "$InstallDir\package.json"){Copy-Item -LiteralPath $InstallDir -Destination "$InstallDir-backup-$(Get-Date -Format yyyyMMdd-HHmmss)" -Recurse}
  Get-ChildItem $PSScriptRoot -File | Where-Object {$_.Name -ne 'config.json'} | Copy-Item -Destination $InstallDir -Force
  Copy-Item -LiteralPath "$PSScriptRoot\public" -Destination $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path "$InstallDir\data" | Out-Null
if(-not(Test-Path "$InstallDir\config.json")){
  if($LegacyRoot -and (Test-Path "$LegacyRoot\config.json")){Copy-Item "$LegacyRoot\config.json" "$InstallDir\config.json"}
  else{Copy-Item "$InstallDir\config.example.json" "$InstallDir\config.json"}
}
$cfg=Get-Content "$InstallDir\config.json" -Raw | ConvertFrom-Json
Copy-Item "$InstallDir\config.json" "$InstallDir\data\config-before-install-$(Get-Date -Format yyyyMMdd-HHmmss).json"
$cfg.defaultModel='all';$cfg | ConvertTo-Json -Depth 20 | Set-Content "$InstallDir\config.json" -Encoding UTF8
$cfg.databases=@($cfg.databases)+@('auto') | Select-Object -Unique
$cfg.logDirectories=@($cfg.logDirectories)+@('auto') | Select-Object -Unique
$cfg | ConvertTo-Json -Depth 20 | Set-Content "$InstallDir\config.json" -Encoding UTF8
if($LegacyRoot){
  if(Test-Path "$LegacyRoot\data\monitor.sqlite"){
    & $monitorNode "$InstallDir\migrate.mjs" --history "$LegacyRoot\data\monitor.sqlite"
    if($LASTEXITCODE -ne 0){throw 'History migration failed'}
  }
  if(Test-Path "$LegacyRoot\seed\measurements.json"){
    & $monitorNode "$InstallDir\migrate.mjs" --seed "$LegacyRoot\seed"
    if($LASTEXITCODE -ne 0){throw 'Seed migration failed'}
  }
}
$pluginRoots=@()
if(-not $SkipDefaultPluginDirectories){
  $pluginRoots+=Join-Path $env:USERPROFILE '.config\opencode\plugins'
  if($env:XDG_CONFIG_HOME){$pluginRoots+=Join-Path $env:XDG_CONFIG_HOME 'opencode\plugins'}
}
$pluginRoots+=$PluginDirectories
$template=Get-Content "$InstallDir\plugin-template.mjs" -Raw -Encoding UTF8
$rootJson=ConvertTo-Json ($InstallDir.Replace('\','/')) -Compress
$plugin=$template.Replace('__MONITOR_ROOT__',$rootJson)
$installed=@()
foreach($dir in ($pluginRoots | Select-Object -Unique)){
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file=Join-Path $dir 'opencode-monitor.js'
  if(Test-Path $file){Copy-Item $file "$file.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"}
  [IO.File]::WriteAllText($file,$plugin,(New-Object Text.UTF8Encoding($false)))
  $installed+=$file
}
$installed | ConvertTo-Json | Set-Content "$InstallDir\data\installed-plugins.json" -Encoding UTF8
Write-Host "Installed: $InstallDir. OpenCode plugin paths: $($installed -join ', ')"
if(-not $NoStart){Start-Process -FilePath "$InstallDir\MonitorTray.exe" -WorkingDirectory $InstallDir -WindowStyle Hidden}
