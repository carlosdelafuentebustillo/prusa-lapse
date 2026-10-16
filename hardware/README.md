# Hardware Guide

This directory contains the physical requirements to build the Prusa-lapse multi-camera system.

## Bill of Materials (BOM)

To build a standard 2-camera setup, you will need:

### Electronics
*   **2x ESP32-CAM Modules** (with OV2640 camera sensors).
*   **2x MicroSD Cards** (8GB or 16GB, Class 10 recommended).
*   **1x 5V Power Supply** (At least 2A output. ESP32-CAMs can draw up to 500mA each during capture/flash).
*   **2x USB-to-TTL Serial Adapters** (FTDI programmer) - *Only needed for initial flashing if your ESP32-CAM doesn't have a built-in USB port.*
*   **Jumper wires / USB cables** (Depending on how you plan to route power).

### Printed Parts
While you can design your own mounts, the 3D printing community has already created excellent models that fit perfectly. We highly recommend searching [Printables.com for "ESP32-CAM Prusa MK4"](https://www.printables.com/search/models?q=ESP32-CAM%20Prusa%20MK4) to find a design that suits your enclosure.

Popular mounting styles include:
*   **Extrusion Frame Mounts (Fixed Position):** These attach directly to the 3030 aluminum extrusions of the printer frame using T-nuts. They are great for fixed-angle timelapses.
*   **X-Axis Idler Mounts (Moves with Z-Axis):** These mount directly to the X-axis motor or idler. The camera moves up with the print nozzle, keeping the top layer constantly in focus.

## Wiring & Power

**Important:** Power delivery is the most common issue with ESP32-CAMs. When taking a picture, the module experiences a sudden current spike. If the voltage drops, the module will brown out and reset.

1.  **Do not rely on the 3.3V pin.** Always power the board using the **5V** and **GND** pins.
2.  **Add Capacitors (Optional but Recommended):** If you experience instability, add a 100uF - 470uF electrolytic capacitor across the 5V and GND pins near the ESP32-CAM to smooth out current spikes.
3.  **Route Power Carefully:** You can tap into a dedicated external 5V power supply, or use an active USB hub if routing power via USB cables.

## Hardware Triggers (Zero-Latency)

The standard Prusa-lapse trigger (`M220 S99`) uses Wi-Fi to poll the PrusaLink API. For the most reliable, instantaneous captures, you can bypass the Wi-Fi entirely by physically wiring the MK4s to the ESP32-CAM.

### 1. Hackerboard GPIO Trigger (M264)
The **Prusa Hackerboard** is an official accessory board for the MK4s that breaks out extra I/O pins for custom electronics. You can connect this board to the ESP32-CAM to trigger a capture instantly via a hardware interrupt.
*   **Wiring**: Connect Hackerboard pin `P0` to ESP32-CAM **GPIO 12**.
*   **Common Ground**: Ensure the Hackerboard and the ESP32-CAM share a common Ground (GND).
> [!WARNING]
> GPIO 12 on the ESP32 is an MTDI "strapping pin". If the Hackerboard accidentally pulls this pin HIGH during the ESP32-CAM's power-on boot sequence, the flash voltage will be misconfigured and the camera will fail to boot. Ensure the printer does not pull this pin high until fully booted, or always power the ESP32-CAM first.

### 2. USB Serial Trigger (M118)
The MK4s xBuddy board has an internal serial header (often used for the ESP-01 Wi-Fi module). You can connect this TX pin (or use a USB-to-TTL adapter from the printer's USB port) to the ESP32-CAM's UART RX pin. This allows the camera to instantly read raw G-Code strings.
*   **Wiring**: Connect Printer **TX** to ESP32-CAM **RX (GPIO 3)**.
*   **Common Ground**: Share a common Ground.

## Assembly Steps

1. Insert the microSD cards into the ESP32-CAMs.
2. Assemble the 3D printed enclosures and mounts.
3. Attach the mounts to the printer frame at your desired angles (e.g., one front-left, one front-right).
4. Run power cables to the cameras, ensuring they do not interfere with the printer's moving parts (X/Y axes and bed).
5. (Optional) Run the trigger wires if you are using Hardware Triggers.

Once assembled, proceed to the [Firmware Guide](../firmware/README.md) to program the cameras.
