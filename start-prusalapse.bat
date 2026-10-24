@echo off
title PrusaLapse Server
setlocal enabledelayedexpansion

echo ================================================================
echo                    PRUSALAPSE WEBAPP LAUNCHER
echo ================================================================
echo.

:: Locate webapp directory
set "ROOT_DIR=%~dp0"
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
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Clean up any stale process occupying port 3000
echo [INFO] Checking port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo [INFO] Stopping stale process on port 3000 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>nul
)

:: 3. Verify dependencies
if not exist "node_modules\" (
    echo [INFO] First-time setup: Installing dependencies...
    call npm.cmd install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: 4. Verify production build
if not exist ".next\" (
    echo [INFO] Building production bundle for fast startup...
    call npm.cmd run build
    if %errorlevel% neq 0 (
        echo [WARN] Production build had errors. Will attempt to start in dev mode.
    )
)

:: 5. Launch browser automatically once server starts
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"

echo.
echo ================================================================
echo   PrusaLapse is running at: http://localhost:3000
echo   Your default web browser is opening automatically.
echo.
echo   Keep this window open while using PrusaLapse.
echo   Press Ctrl+C to stop the server.
echo ================================================================
echo.

:: 6. Start server (production mode)
if exist ".next\" (
    call npm.cmd run start
) else (
    call npm.cmd run dev
)

if %errorlevel% neq 0 (
    echo.
    echo [WARN] Production server exited with error. Trying dev mode...
    call npm.cmd run dev
)

echo.
echo [INFO] Server stopped.
pause
