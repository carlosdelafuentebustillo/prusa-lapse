@echo off
setlocal
echo Creating PrusaLapse shortcut in project folder...

set "ROOT_DIR=%~dp0"
set "BAT_PATH=%ROOT_DIR%start-prusalapse.bat"
set "ICO_PATH=%ROOT_DIR%prusalapse.ico"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$sc = $ws.CreateShortcut((Join-Path '%ROOT_DIR%' 'PrusaLapse.lnk')); " ^
  "$sc.TargetPath = '%BAT_PATH%'; " ^
  "$sc.WorkingDirectory = '%ROOT_DIR%'; " ^
  "$sc.IconLocation = '%ICO_PATH%'; " ^
  "$sc.Description = 'PrusaLapse Camera & Timelapse Webapp'; " ^
  "$sc.Save(); " ^
  "Write-Host 'Shortcut created at: ' (Join-Path '%ROOT_DIR%' 'PrusaLapse.lnk')"

echo Done!
