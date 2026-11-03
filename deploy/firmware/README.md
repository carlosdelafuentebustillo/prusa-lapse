# PrusaLapse Firmware (ESP32-CAM)

This package contains the precompiled firmware binaries for the **PrusaLapse ESP32-CAM** timelapse capture modules.

## Files
* `firmware.bin` — The main application binary (Flash address `0x10000`).
* `bootloader.bin` — Second stage bootloader (Flash address `0x1000`).
* `partitions.bin` — Partition table (Flash address `0x8000`).
* `flash-firmware-windows.bat` — 1-click Windows USB flashing script.
* `flash-firmware-linux.sh` — 1-click Linux/macOS USB flashing script.

---

## Method 1: Web Over-The-Air (OTA) Update (Recommended for existing cameras)

If your camera is already connected to your Wi-Fi network:
1. Open the PrusaLapse webapp at `http://localhost:3000` (or your server IP).
2. Go to the camera card on the dashboard.
3. Click the **Update Firmware** button.
4. The webapp will automatically stream `firmware.bin` to the camera over Wi-Fi without needing any cables or USB adapters!

Alternatively, using `curl`:
```bash
curl -F "update=@firmware.bin" http://<CAMERA_IP>/update
```

---

## Method 2: Initial USB Flashing (FTDI Programmer)

For brand new ESP32-CAM boards:

### 1. Wiring (FTDI to ESP32-CAM)
| FTDI Programmer | ESP32-CAM |
|-----------------|-----------|
| 5V (or VCC)     | 5V        |
| GND             | GND       |
| TXD             | U0R (RX)  |
| RXD             | U0T (TX)  |
| **GND**         | **IO0** *(Must be connected during flash!)* |

### 2. Flashing
* **Windows**: Double-click `flash-firmware-windows.bat`.
* **Linux**: Run `chmod +x flash-firmware-linux.sh && ./flash-firmware-linux.sh`.

### 3. First-Time Setup
1. Unplug the jumper wire between **IO0** and **GND**.
2. Press the **RST** button on the back of the ESP32-CAM.
3. On your phone or PC, connect to the Wi-Fi network: `PrusaLapse-Setup`.
4. In the portal that opens (or browse to `http://192.168.4.1`):
   * Select your home Wi-Fi network and enter the password.
   * Enter your Prusa printer's local IP address (e.g. `192.168.1.59`) and API Key.
5. Click **Save**. The camera will connect to your network and start syncing!
