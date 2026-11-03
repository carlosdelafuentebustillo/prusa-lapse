@echo off
setlocal enabledelayedexpansion
title PrusaLapse ESP32-CAM USB Flasher (Windows)

echo ================================================================
echo           PRUSALAPSE ESP32-CAM USB FLASH UTILITY
echo ================================================================
echo.
echo Make sure:
echo  1. IO0 (Pin 0) is connected to GND before plugging in USB!
echo  2. FTDI programmer is set to 5V (or 3.3V with stable power).
echo  3. FTDI TX -> ESP32 U0R (RX), FTDI RX -> ESP32 U0T (TX).
echo ================================================================
echo.

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

:: Check for python/esptool
where esptool.py >nul 2>nul
if %errorlevel% neq 0 (
    where python >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Neither esptool.py nor Python was found on your system!
        echo Please install Python from https://www.python.org/downloads/
        echo (Check "Add Python to PATH" during installation)
        echo Then run: pip install esptool
        echo.
        pause
        exit /b 1
    )
    echo [INFO] esptool.py not in PATH, checking python -m esptool...
    python -m esptool version >nul 2>nul
    if %errorlevel% neq 0 (
        echo [INFO] Installing esptool via pip...
        pip install --upgrade esptool
        if %errorlevel% neq 0 (
            echo [ERROR] Failed to install esptool.
            pause
            exit /b 1
        )
    )
    set "ESPTOOL=python -m esptool"
) else (
    set "ESPTOOL=esptool.py"
)

:: Detect COM ports via PowerShell
echo [INFO] Detecting connected serial ports...
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames() -join ' '"`) do set "PORTS=%%P"

if "%PORTS%"=="" (
    echo [WARN] No active COM ports detected! Plug in your FTDI adapter.
    set /p "TARGET_PORT=Enter COM port manually (e.g. COM3): "
) else (
    echo Connected COM ports: %PORTS%
    for %%A in (%PORTS%) do set "DEFAULT_PORT=%%A"
    set /p "TARGET_PORT=Enter COM port to flash [Default: !DEFAULT_PORT!]: "
    if "!TARGET_PORT!"=="" set "TARGET_PORT=!DEFAULT_PORT!"
)

if "!TARGET_PORT!"=="" (
    echo [ERROR] No COM port specified. Aborting.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo Target Port: !TARGET_PORT!
echo Flashing PrusaLapse Firmware (ESP32-CAM) @ 460800 baud...
echo ================================================================
echo.

if exist "bootloader.bin" if exist "partitions.bin" (
    echo [INFO] Performing full flash (bootloader + partitions + firmware)...
    %ESPTOOL% --chip esp32 --port !TARGET_PORT! --baud 460800 --before default_reset --after hard_reset write_flash -z --flash_mode dio --flash_freq 40m --flash_size detect 0x1000 bootloader.bin 0x8000 partitions.bin 0x10000 firmware.bin
) else (
    echo [INFO] Flashing application binary (firmware.bin) to 0x10000...
    %ESPTOOL% --chip esp32 --port !TARGET_PORT! --baud 460800 --before default_reset --after hard_reset write_flash -z --flash_mode dio --flash_freq 40m --flash_size detect 0x10000 firmware.bin
)

if %errorlevel% equ 0 (
    echo.
    echo ================================================================
    echo [SUCCESS] Flash completed successfully!
    echo.
    echo Next steps:
    echo  1. Disconnect Pin IO0 from GND.
    echo  2. Press the RST button on the ESP32-CAM or power-cycle.
    echo  3. Connect to the "PrusaLapse-Setup" Wi-Fi access point
    echo     to configure your Wi-Fi and Printer IP!
    echo ================================================================
) else (
    echo.
    echo [ERROR] Flashing failed! Check connections, make sure IO0 is grounded,
    echo and press the RST button right before flashing starts.
)

echo.
pause
