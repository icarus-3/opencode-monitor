$ErrorActionPreference='Stop'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ /out:"$PSScriptRoot\MonitorTray.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "$PSScriptRoot\MonitorTray.cs"
if($LASTEXITCODE -ne 0){throw 'Tray build failed'}
