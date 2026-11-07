#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================================"
echo "          PRUSALAPSE ESP32-CAM USB FLASH UTILITY (LINUX)       "
echo "================================================================"
echo ""
echo "Make sure:"
echo " 1. IO0 (Pin 0) is connected to GND before plugging in USB!"
echo " 2. FTDI programmer is set to 5V (or 3.3V with stable power)."
echo " 3. FTDI TX -> ESP32 U0R (RX), FTDI RX -> ESP32 U0T (TX)."
echo "================================================================"
echo ""

# Find esptool
if command -v esptool.py >/dev/null 2>&1; then
    ESPTOOL="esptool.py"
elif command -v esptool >/dev/null 2>&1; then
    ESPTOOL="esptool"
elif command -v python3 >/dev/null 2>&1; then
    if python3 -m esptool version >/dev/null 2>&1; then
        ESPTOOL="python3 -m esptool"
    else
        echo "[INFO] Installing esptool via pip..."
        pip3 install --user esptool || sudo apt-get install -y esptool || sudo pacman -S --noconfirm esptool || true
        ESPTOOL="python3 -m esptool"
    fi
else
    echo "[ERROR] Python 3 or esptool is required. Please install esptool."
    exit 1
fi

# Detect serial ports
PORTS=($(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true))

if [ ${#PORTS[@]} -eq 0 ]; then
    echo "[WARN] No /dev/ttyUSB* or /dev/ttyACM* devices found!"
    read -rp "Enter serial device path manually (e.g. /dev/ttyUSB0): " TARGET_PORT
else
    echo "Detected serial devices: ${PORTS[*]}"
    DEFAULT_PORT="${PORTS[0]}"
    read -rp "Enter serial device to flash [Default: ${DEFAULT_PORT}]: " TARGET_PORT
    TARGET_PORT="${TARGET_PORT:-$DEFAULT_PORT}"
fi

if [ -z "$TARGET_PORT" ]; then
    echo "[ERROR] No serial device specified. Aborting."
    exit 1
fi

echo ""
echo "Flashing ESP32-CAM on $TARGET_PORT at 460800 baud..."

if [ -f "bootloader.bin" ] && [ -f "partitions.bin" ]; then
    echo "[INFO] Performing full flash (bootloader + partitions + firmware)..."
    $ESPTOOL --chip esp32 --port "$TARGET_PORT" --baud 460800 --before default_reset --after hard_reset write_flash -z --flash_mode dio --flash_freq 40m --flash_size detect 0x1000 bootloader.bin 0x8000 partitions.bin 0x10000 firmware.bin
else
    echo "[INFO] Flashing application binary (firmware.bin) to 0x10000..."
    $ESPTOOL --chip esp32 --port "$TARGET_PORT" --baud 460800 --before default_reset --after hard_reset write_flash -z --flash_mode dio --flash_freq 40m --flash_size detect 0x10000 firmware.bin
fi

echo ""
echo "================================================================"
echo "[SUCCESS] Flash completed successfully!"
echo ""
echo "Next steps:"
echo " 1. Disconnect Pin IO0 from GND."
echo " 2. Press the RST button on the ESP32-CAM or power-cycle."
echo " 3. Connect to the 'PrusaLapse-Setup' Wi-Fi access point"
echo "    to configure your Wi-Fi credentials and Printer IP!"
echo "================================================================"
