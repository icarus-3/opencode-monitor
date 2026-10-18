param([Parameter(Mandatory=$true)][string]$InstallDir,[Parameter(Mandatory=$true)][string]$BackupDir,[switch]$Rollback)
$ErrorActionPreference='Stop'
$journal=Join-Path $BackupDir 'plugin-hooks.json'
if($Rollback){
  if(Test-Path -LiteralPath $journal){$restore=Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json;foreach($item in $restore){Copy-Item -LiteralPath $item.backup -Destination $item.target -Force}}
  return
}
$manifest=Join-Path $InstallDir 'data\installed-plugins.json'
if(-not(Test-Path -LiteralPath $manifest)){return}
$root=[IO.Path]::GetFullPath($InstallDir).TrimEnd('\','/')
$template=Get-Content -LiteralPath (Join-Path $InstallDir 'plugin-template.mjs') -Raw -Encoding UTF8
$plugin=$template.Replace('__MONITOR_ROOT__',(ConvertTo-Json ($root.Replace('\','/')) -Compress))
$items=@();New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
$files=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
foreach($file in $files){
  if(-not(Test-Path -LiteralPath $file) -or [IO.Path]::GetFileName($file) -ne 'opencode-monitor.js'){continue}
  $text=Get-Content -LiteralPath $file -Raw -Encoding UTF8
  $match=[regex]::Match($text,'const root=("(?:[^"\\]|\\.)*");')
  if(-not $match.Success){continue}
  $owner=$match.Groups[1].Value | ConvertFrom-Json
  if([IO.Path]::GetFullPath($owner).TrimEnd('\','/') -ne $root){continue}
  $backup=Join-Path $BackupDir ("plugin-"+$items.Count+'.js')
  Copy-Item -LiteralPath $file -Destination $backup -Force
  $items+=@{target=$file;backup=$backup}
  ConvertTo-Json -InputObject @($items) -Depth 4 | Set-Content -LiteralPath $journal -Encoding UTF8
  [IO.File]::WriteAllText($file,$plugin,(New-Object Text.UTF8Encoding($false)))
}
