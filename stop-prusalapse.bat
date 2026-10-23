@echo off
title Stop Prusa-lapse
setlocal enabledelayedexpansion

echo ================================================================
echo                     STOPPING PRUSA-LAPSE
echo ================================================================
echo.

set FOUND=0

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    set PID=%%a
    if defined PID (
        set FOUND=1
        echo [INFO] Stopping Prusa-lapse process on port 3000 [PID: !PID!]...
        taskkill /F /PID !PID! >nul 2>nul
        if errorlevel 1 (
            echo [WARN] Could not terminate PID !PID!. It may have already exited.
        ) else (
            echo [SUCCESS] Process !PID! stopped.
        )
    )
)

if "!FOUND!"=="0" (
    echo [INFO] Prusa-lapse does not appear to be running on port 3000.
) else (
    echo.
    echo [SUCCESS] Prusa-lapse has been stopped.
)

echo.
ping 127.0.0.1 -n 3 >nul
exit /b 0
