# Prusa-lapse Firmware & Hardware Guide (ESP32-CAM)

This directory contains the custom **ESP32-CAM** firmware, 1-click USB flashing scripts, and hardware wiring instructions for the Prusa-lapse multi-camera system.

---

## 1. Hardware Requirements & Wiring

### Bill of Materials (BOM)
* **ESP32-CAM Modules** (with OV2640 camera sensors).
* **MicroSD Cards** (8GB or 16GB, Class 10 recommended, formatted as FAT32).
* **5V Power Supply** (At least 2A output; ESP32-CAMs draw up to 500mA each during capture/flash).
* **USB-to-TTL Serial Adapter** (FTDI programmer) — only required for initial USB flashing.

### Power Delivery
1. **Always power via 5V and GND pins.** Do not power via the 3.3V pin, which causes brownout resets during Wi-Fi/SD peaks.
2. **Optional Capacitor:** Add a 100µF–470µF electrolytic capacitor across 5V and GND near the ESP32-CAM if using long USB/jumper runs.

### Trigger Modes
Prusa-lapse supports three ways to trigger layer captures:
1. **Wireless PrusaLink Polling (`M220 S99`)**: Default mode, zero extra wiring required. The camera polls PrusaLink over Wi-Fi and triggers when speed changes to `99%` or on confirmed Smart Z layer changes.
2. **Hackerboard GPIO Trigger (`M264 P0 S1`)**: Connect Prusa Hackerboard pin `P0` to ESP32-CAM **GPIO 12** and share Common Ground (`GND`). Note: GPIO 12 is a strapping pin and must not be pulled high during ESP32 boot.
3. **USB Serial UART (`M118 action:capture_photo`)**: Connect Printer **TX** to ESP32-CAM **RX (GPIO 3)** and share Common Ground (`GND`).

---

## 2. Flashing the Firmware

### Method A: Web Over-The-Air (OTA) Update (Existing Cameras)
If your camera is already connected to your Wi-Fi network:
1. Open the PrusaLapse dashboard (`http://localhost:3000`).
2. Locate the camera card and click **Update Firmware**.
3. Alternatively, upload via `curl`:
   ```bash
   curl -F "update=@firmware.bin" http://<CAMERA_IP>/update
   ```

### Method B: Initial USB Flashing (Release Package)
1. Wire your FTDI programmer to the ESP32-CAM:
   | FTDI Programmer | ESP32-CAM |
   | :--- | :--- |
   | 5V (VCC) | 5V |
   | GND | GND |
   | TXD | U0R (RX) |
   | RXD | U0T (TX) |
   | **GND** | **IO0** *(Shorted to GND during flash)* |
2. Run the flasher script from the release package (or this directory after compiling):
   * **Windows**: Double-click `flash-firmware-windows.bat`.
   * **Linux / macOS**: Run `chmod +x flash-firmware-linux.sh && ./flash-firmware-linux.sh`.

### Method C: Compile from Source (PlatformIO)
```bash
pio run -d firmware
pio run -d firmware -t upload
```

---

## 3. First-Time Wi-Fi Setup

1. Disconnect the jumper wire between **IO0** and **GND** and press the **RST** button on the ESP32-CAM.
2. Connect your phone or PC to the `PrusaLapse-Setup` (or `PrusaLapse-Camera`) Wi-Fi AP.
3. Browse to `http://192.168.4.1`, enter your home Wi-Fi credentials, Prusa printer IP, and PrusaLink API Key, and click **Save**.
