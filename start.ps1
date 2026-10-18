$ErrorActionPreference='Stop'
Start-Process -FilePath "$PSScriptRoot\MonitorTray.exe" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
