@echo off
setlocal
echo Creating Desktop shortcut for PrusaLapse...

set "ROOT_DIR=%~dp0"
set "BAT_PATH=%ROOT_DIR%start-prusalapse.bat"
set "ICO_PATH=%ROOT_DIR%prusalapse.ico"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$sc = $ws.CreateShortcut((Join-Path $desktop 'PrusaLapse.lnk')); " ^
  "$sc.TargetPath = '%BAT_PATH%'; " ^
  "$sc.WorkingDirectory = '%ROOT_DIR%'; " ^
  "$sc.IconLocation = '%ICO_PATH%'; " ^
  "$sc.Description = 'PrusaLapse Camera & Timelapse Webapp'; " ^
  "$sc.Save(); " ^
  "Write-Host 'Desktop shortcut created successfully at: ' (Join-Path $desktop 'PrusaLapse.lnk')"

echo Done!
