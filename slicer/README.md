# Slicer Configuration

To create cinematic timelapses, the print head must move out of the camera's view after every layer so the ESP32-CAMs can capture a clean frame. This directory explains how to configure your G-code to handle this sequence.

These instructions are tailored for **PrusaSlicer** and the **Prusa MK4s**.

---

## The Strategy

At each layer boundary, the printer will:

1. **Retract** a small amount of filament (prevents oozing/stringing).
2. **Hop** the Z-axis (prevents scratching the model).
3. **Park** the print head to a fixed position (e.g., `X240 Y210`).
4. **Wait** briefly for vibrations to settle.
5. **Signal** the ESP32-CAM to capture a photo using one of three triggering methods.
6. **Wait** for the cameras to capture the frame.
7. *(Optional)* Return to a Prime / Ooze Tower to purge oozed plastic.
8. **Un-retract** and resume printing.

---

## Method 1 — Web App Post-Processor (Easiest)

**The most seamless approach.** Use the G-Code Post-Processor built directly into the Prusa-lapse web application.

### Steps
1. Slice your model normally in PrusaSlicer and export the `.gcode` file.
2. Open the Prusa-lapse Web Interface and scroll to the **G-Code Post-Processor** panel.
3. Drag and drop your `.gcode` file into the upload zone.
4. Configure your trigger settings (Park X/Y, Trigger Signal, etc.).
5. Click **Inject Triggers & Export G-Code**.
6. A 3D preview of your modified toolpath will appear, and your smart G-code will be downloaded. Upload this file to your printer!

---

## Method 2 — Custom G-Code Snippet (Prusa Connect Compatible)

If you want PrusaSlicer to inject the triggers automatically so you can use the "Send to Prusa Connect" button, you can modify your existing printer profile using a custom snippet.

### Steps
1. Open **PrusaSlicer** and select your existing printer profile that is linked to Prusa Connect.
2. Go to the **Printer Settings** tab, and click on **Custom G-code** in the left sidebar.
3. Open [`PrusaLapse_Snippet.txt`](PrusaLapse_Snippet.txt) from this directory.
4. Copy the G-code from the text file and paste it at the very bottom of the **After layer change G-code** text box.
5. Click the "Save" icon to save this as a variation of your current profile. Your physical Prusa Connect configuration will remain intact!

---

## Method 3 — CLI Tool

Use the lightweight Command-Line tool to automatically inject the complex G-code into your models in bulk.

### Steps
1. Open your terminal and navigate to the `cli/` directory.
2. Edit `config.json` to configure your preferences:
   - **triggerType**: Set to `park` to park the print head during capture.
   - **parkX** / **parkY**: Set the desired parking coordinates.
   - **triggerSignal**: Select your preferred method (`m220`, `gpio0`, or `serial`).
3. Run the CLI tool on your sliced `.gcode` file: `prusalapse.bat path/to/your/file.gcode` (or use `node prusalapse.mjs` directly).
4. The tool will inject the necessary G-code.

---

## Trigger Signals

Prusa-lapse supports three different ways to tell the ESP32-CAM to take a photo. You must select the one that matches your physical wiring.

### 1. PrusaLink API (M220 S99)
- **How it works:** The G-code sets the printer speed to 99% (`M220 S99`). The ESP32-CAM constantly polls the printer over Wi-Fi and snaps a photo when it sees the speed change.
- **Pros:** Completely wireless. No physical wiring required.
- **Cons:** Network latency can cause a 1-3 second delay.
- **G-code:** `M220 S99` (trigger) ... `M220 S100` (restore).

### 2. Hardware GPIO (M264 P0 S1)
- **How it works:** The G-code toggles a physical pin on the Prusa Hackerboard, which is hard-wired to GPIO 12 on the ESP32-CAM.
- **Pros:** Instantaneous, zero latency. Works completely offline.
- **Cons:** Requires the Prusa Hackerboard accessory and custom wiring.
- **G-code:** `M264 P0 S1` (trigger pulse high) ... `G4 P100` ... `M264 P0 S0` (reset pulse low).

### 3. USB Serial UART (M118)
- **How it works:** The G-code sends a raw text string out of the printer's serial port (via USB or ESP-01 header), which is parsed by the ESP32-CAM.
- **Pros:** Instantaneous, zero latency. Works completely offline.
- **Cons:** Requires a custom serial wiring harness or USB-to-TTL adapter.
- **G-code:** `M118 action:capture_photo`.

---

## Recommended Tuning Parameters

Because the nozzle remains heated and parked at the camera trigger spot for several seconds, setting appropriate travel, retraction, and speed values is critical.

| Parameter | G-code / Config Unit | Direct Drive *(e.g., MK4)* | Bowden Drive *(e.g., MINI+)* |
| :--- | :---: | :---: | :---: |
| **Retraction Distance** | `E` (mm) | **`1.2` to `1.5` mm** | **`3.0` to `4.0` mm** |
| **Retraction Speed** | `F` (mm/min) | **`2100` to `2700`** *(35–45 mm/s)* | **`2400` to `3300`** *(40–55 mm/s)* |
| **Travel Speed** | `F` (mm/min) | **`9000` to `12000`** *(150–200 mm/s)* | **`9000`** *(150 mm/s)* |
| **Z-Hop Height** | `Z` (mm) | **`0.4` mm** | **`0.4` mm** |

> [!TIP]
> If you experience stringing or wisps on the travel path, enable **Wipe while retracting** in your slicer settings.
