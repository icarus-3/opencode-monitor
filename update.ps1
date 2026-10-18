param([string]$InstallDir,[string]$StagedDir,[string]$BackupDir,[int]$ServerProcessId,[int]$TrayProcessId,[int]$Port,[int]$ReadinessAttempts=60)
$ErrorActionPreference='Stop'
$InstallDir=[IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$statusFile=Join-Path $InstallDir 'data\update-status.json'
function Status($state,$message){@{state=$state;message=$message;helper_pid=$PID;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding UTF8}
$copied=@();$replaced=$false;$newTray=$null
try{
  Status 'applying' 'Waiting for Monitor to stop'
  foreach($idValue in @($ServerProcessId,$TrayProcessId)){
    if($idValue -le 0){continue};$proc=Get-Process -Id $idValue -ErrorAction SilentlyContinue
    if($proc -and -not $proc.WaitForExit(40000)){throw 'Monitor did not stop; files were not replaced'}
  }
  $manifest=Get-Content (Join-Path $StagedDir 'update-manifest.json') -Raw | ConvertFrom-Json
  foreach($property in $manifest.files.PSObject.Properties){
    $relative=$property.Name
    if($relative -match '(^|/)\.\.?(/|$)|:|\\|^/|^(data|seed|runtime|node_modules|\.git)(/|$)|^config\.json$'){throw 'Unsafe manifest path'}
    $source=Join-Path $StagedDir $relative
    if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $property.Value){throw 'Staged checksum mismatch'}
    $target=Join-Path $InstallDir $relative;$backup=Join-Path (Join-Path $BackupDir 'program') $relative
    if(Test-Path -LiteralPath $target){New-Item -ItemType Directory -Path (Split-Path $backup) -Force | Out-Null;Copy-Item -LiteralPath $target -Destination $backup -Force}
    $copied+=@{target=$target;backup=$backup;existed=(Test-Path -LiteralPath $target)}
  }
  $manifestTarget=Join-Path $InstallDir 'update-manifest.json';$manifestBackup=Join-Path $BackupDir 'update-manifest.json'
  if(Test-Path -LiteralPath $manifestTarget){Copy-Item -LiteralPath $manifestTarget -Destination $manifestBackup -Force}
  $copied+=@{target=$manifestTarget;backup=$manifestBackup;existed=(Test-Path -LiteralPath $manifestTarget)}
  $replaced=$true
  foreach($item in $copied){$relative=$item.target.Substring($InstallDir.Length+1);New-Item -ItemType Directory -Path (Split-Path $item.target) -Force | Out-Null;Copy-Item -LiteralPath (Join-Path $StagedDir $relative) -Destination $item.target -Force}
  & (Join-Path $InstallDir 'sync-hooks.ps1') -InstallDir $InstallDir -BackupDir (Join-Path $BackupDir 'hooks')
  $newTray=Start-Process -FilePath (Join-Path $InstallDir 'MonitorTray.exe') -WorkingDirectory $InstallDir -WindowStyle Hidden -PassThru
  $ready=$false
  for($i=0;$i -lt $ReadinessAttempts;$i++){Start-Sleep -Milliseconds 500;try{$h=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 1;$readyTray=[int](Get-Content (Join-Path $InstallDir 'data\tray.pid') -Raw);if($h.app -eq 'opencode-monitor' -and $h.version -eq $manifest.version -and [IO.Path]::GetFullPath($h.root).TrimEnd('\') -eq $InstallDir -and $readyTray -eq $newTray.Id){$ready=$true;break}}catch{}}
  if(-not $ready){throw 'New version did not become healthy'}
  Status 'installed' $manifest.version
}catch{
  $failure=$_.Exception.Message
  try{
    $tokenFile=Join-Path $InstallDir 'data\control.token'
    if(Test-Path $tokenFile){$token=(Get-Content $tokenFile -Raw).Trim();try{Invoke-RestMethod -Method Post "http://127.0.0.1:$Port/api/shutdown" -Headers @{Authorization="Bearer $token"} -TimeoutSec 2 | Out-Null}catch{}}
    Start-Sleep -Seconds 2
    if($newTray -and -not $newTray.HasExited){$newTray.Kill();$newTray.WaitForExit()}
    if($replaced){& (Join-Path $StagedDir 'sync-hooks.ps1') -InstallDir $InstallDir -BackupDir (Join-Path $BackupDir 'hooks') -Rollback;foreach($item in $copied){if($item.existed){Copy-Item -LiteralPath $item.backup -Destination $item.target -Force}else{if(Test-Path -LiteralPath $item.target){Remove-Item -LiteralPath $item.target -Force}}}}
    Start-Process -FilePath (Join-Path $InstallDir 'MonitorTray.exe') -WorkingDirectory $InstallDir -WindowStyle Hidden
  }catch{$failure+='; rollback: '+$_.Exception.Message}
  Status 'failed' $failure
  Add-Type -AssemblyName System.Windows.Forms
  [Windows.Forms.MessageBox]::Show($failure,'OpenCode Monitor update failed') | Out-Null
  exit 1
}
