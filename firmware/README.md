# Prusa-lapse Firmware

This directory contains the custom **ESP32-CAM** firmware for the Prusa-lapse project. 

The firmware provides:
* **Prusa Connect Cloud Integration**: Native HTTPS uploads of snapshots directly to `webcam.connect.prusa3d.com` without needing the webapp running.
* **Lightweight Local Snapshots**: A fast, cache-busting `/snapshot.jpg` endpoint that the Prusa-lapse Webapp uses for multi-camera cinematic timelapses.
* **Zero-Latency Hardware Triggers**: The firmware can instantly spawn a capture task via a GPIO 12 hardware interrupt or by parsing `M118 action:capture_photo` strings over the Serial UART, bypassing network polling completely.
* **Wi-Fi Manager**: A captive portal to easily enter your home Wi-Fi credentials without hardcoding them.
* **SD Card Fallback**: If configured, the camera can save high-resolution `.jpg` images directly to the SD card during an offline timelapse.

## 1. How to Compile and Flash

This project uses **PlatformIO** to manage dependencies and compilation.

1. Install [Visual Studio Code](https://code.visualstudio.com/) and the [PlatformIO IDE extension](https://platformio.org/install/ide?install=vscode).
2. Open the `firmware` folder in VS Code.
3. Connect your ESP32-CAM to your computer using an FTDI adapter. (Remember to short GPIO 0 to GND while powering on to enter flashing mode).
4. Click the **PlatformIO: Upload** button (the right arrow `→` in the bottom status bar).

## 2. Setting up the Camera

1. **Power it on:** Provide 5V to your ESP32-CAM. If this is the first boot, it will fail to connect to Wi-Fi and fall back to AP mode.
2. **Connect to the AP:** The camera will broadcast a Wi-Fi network named `PrusaLapse-Camera`. Connect to it (Password: `12345678`).
3. **Configure Wi-Fi:** Open your browser and navigate to `http://192.168.4.1`. Enter your home Wi-Fi network details and click "Save & Connect".
4. **Find its new IP:** Check your router to find the camera's new IP address on your home network.

## 3. Integrating with Prusa-lapse and Prusa Connect

Once the camera is online and connected to your network:
1. Open the **Prusa-lapse Webapp Dashboard**.
2. Enter the camera's IP address in the configuration panel.
3. The webapp will pull a live preview using `/snapshot.jpg`.
4. **Prusa Connect (Optional)**: In the webapp monitor dashboard, you can paste in a Prusa Connect Camera Token. The firmware will save this token to its non-volatile memory and automatically begin uploading a snapshot to Prusa Connect every 10 seconds. You do NOT need the webapp running for this cloud integration to work!
