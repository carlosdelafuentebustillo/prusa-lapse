@echo off
title Prusa-lapse Server

echo ================================================================
echo                    PRUSA-LAPSE WEBAPP LAUNCHER
echo ================================================================
echo.

:: Locate webapp directory
set "APP_DIR=%~dp0webapp"
if not exist "%APP_DIR%\package.json" (
    set "APP_DIR=C:\Users\cafub\Documents\Antigravity\dual-dalmatian\webapp"
)

if not exist "%APP_DIR%\package.json" (
    echo [ERROR] Could not find the webapp directory!
    echo Looked in: "%APP_DIR%"
    pause
    exit /b 1
)

cd /d "%APP_DIR%"

:: 1. Verify Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found in your system PATH!
    echo Please install Node.js v18 or higher from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Verify dependencies
if not exist "node_modules\" (
    echo [INFO] First-time setup: Installing dependencies...
    call npm.cmd install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: 3. Verify production build
if not exist ".next\" (
    echo [INFO] Building production bundle for fast startup...
    call npm.cmd run build
    if %errorlevel% neq 0 (
        echo [WARN] Production build had errors. Will attempt to start in dev mode.
    )
)

:: 4. Launch browser in background after 2 seconds
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"

echo [INFO] Server starting at: http://localhost:3000
echo [INFO] Your browser will open automatically.
echo.
echo Press Ctrl+C in this window to stop the server.
echo ================================================================
echo.

:: 5. Start server (production start preferred)
if exist ".next\" (
    call npm.cmd run start
) else (
    call npm.cmd run dev
)

if %errorlevel% neq 0 (
    echo.
    echo [WARN] Production server failed to start. Trying dev mode...
    call npm.cmd run dev
)

echo.
echo [INFO] Server stopped.
pause
