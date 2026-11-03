@echo off
setlocal
title PrusaLapse Portable

echo ================================================================
echo                    PRUSALAPSE PORTABLE (WINDOWS)               
echo ================================================================
echo.

set "BASE_DIR=%~dp0"
set "NODE_EXE=%BASE_DIR%runtime\node.exe"

if not exist "%NODE_EXE%" (
    where node >nul 2>nul
    if %errorlevel% equ 0 (
        set "NODE_EXE=node"
    ) else (
        echo [ERROR] Portable Node.js runtime not found at: %BASE_DIR%runtime\node.exe
        echo Please ensure the runtime folder is present.
        pause
        exit /b 1
    )
)

set "PORT=3000"
set "HOSTNAME=0.0.0.0"
set "NODE_ENV=production"

if exist "%BASE_DIR%bin\ffmpeg.exe" (
    set "FFMPEG_PATH=%BASE_DIR%bin\ffmpeg.exe"
)

:: Clear port 3000 if an old instance is running
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 3000 -ErrorAction Stop | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {}; exit 0" >nul 2>nul

echo [INFO] Starting PrusaLapse server...
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"

echo.
echo ================================================================
echo   PrusaLapse is active at: http://localhost:3000
echo   Your web browser will open automatically in 2 seconds.
echo.
echo   Keep this window open while using PrusaLapse.
echo   Close this window or press Ctrl+C to stop.
echo ================================================================
echo.

if exist "%BASE_DIR%app\server.js" (
    cd /d "%BASE_DIR%app"
    "%NODE_EXE%" server.js
) else (
    cd /d "%BASE_DIR%"
    "%NODE_EXE%" server.js
)

pause
