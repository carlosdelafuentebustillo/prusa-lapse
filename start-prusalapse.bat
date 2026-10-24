@echo off
title PrusaLapse
setlocal

echo ================================================================
echo                    PRUSALAPSE WEBAPP LAUNCHER
echo ================================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "APP_DIR=%SCRIPT_DIR%webapp"

if not exist "%APP_DIR%\package.json" (
    echo [ERROR] Cannot find webapp at: %APP_DIR%
    echo Please make sure this script is inside the dual-dalmatian folder.
    echo.
    pause
    exit /b 1
)

cd /d "%APP_DIR%"

:: 1. Verify Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found in your system PATH!
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Clear port 3000 if an old instance is still running
echo [INFO] Preparing port 3000...
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 3000 -ErrorAction Stop | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {}; exit 0" >nul 2>nul

:: 3. Verify dependencies
if not exist "node_modules\" (
    echo [INFO] Installing webapp dependencies...
    call npm.cmd install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

:: 4. Verify build
if not exist ".next\" (
    echo [INFO] Building production webapp...
    call npm.cmd run build
)

:: 5. Open browser automatically
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"

echo.
echo ================================================================
echo   PrusaLapse is running at: http://localhost:3000
echo   Your web browser will open automatically in 2 seconds.
echo.
echo   Keep this window open while using PrusaLapse.
echo   Close this window or press Ctrl+C to stop.
echo ================================================================
echo.

call npm.cmd run start

if %errorlevel% neq 0 (
    echo.
    echo [WARN] Production start exited with error. Trying dev mode...
    call npm.cmd run dev
)

echo.
echo [INFO] Server stopped.
pause
