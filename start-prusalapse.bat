@echo off
title Prusa-lapse Server
setlocal enabledelayedexpansion

cd /d "%~dp0\webapp"

echo ================================================================
echo                    PRUSA-LAPSE WEBAPP LAUNCHER
echo ================================================================
echo.

:: 1. Check for Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found in your system PATH!
    echo Please install Node.js (v18 or higher) from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Check if dependencies are installed
if not exist "node_modules\" (
    echo [INFO] First-time setup: Installing dependencies...
    call npm.cmd install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: 3. Check if production build exists
if not exist ".next\" (
    echo [INFO] Building production bundle for fast startup...
    call npm.cmd run build
    if errorlevel 1 (
        echo [WARN] Production build failed. Will attempt to run in development mode.
    )
)

:: 4. Open browser after brief delay in background
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

echo [INFO] Server starting on http://localhost:3000
echo [INFO] Your browser will open automatically.
echo.
echo Press Ctrl+C in this window or run stop-prusalapse.bat to stop.
echo ================================================================
echo.

:: 5. Try production start first, fall back to dev if needed
if exist ".next\" (
    call npm.cmd run start
) else (
    call npm.cmd run dev
)

if errorlevel 1 (
    echo.
    echo [INFO] Attempting to run via Next.js dev server...
    call npm.cmd run dev
)

pause
