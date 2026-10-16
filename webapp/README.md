# Prusa-lapse Webapp

This is the Next.js web application that serves as the command center for your Prusa-lapse setup.

It provides a beautiful dashboard to:
* Configure your printer's IP and PrusaLink API Key.
* Add multiple ESP32-CAMs to your setup.
* View a live, lightweight snapshot preview of all your cameras.
* Adjust camera parameters (flash, flip, mirror, offline mode).
* Authenticate your cameras directly with the **Prusa Connect Cloud**.
* Dynamically fetch offline sessions and images directly from the cameras when prints finish.
* Compile the captured frames into a cinematic `.mp4` video directly on your desktop using FFmpeg.

## Getting Started

### Prerequisites
You need Node.js installed on your computer.

### Installation

First, install the dependencies:

```bash
npm install
```

### Running the Application

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the dashboard.

## Usage Guide

1. Enter your **Prusa MK4 IP Address** and **PrusaLink API Key** (found in your printer's network settings) in the top configuration panel.
2. Click **Add Camera** and enter the IP address of your ESP32-CAM.
3. (Optional) Paste a **Prusa Connect Token** for your camera and click "Save Token". The camera will begin uploading to Prusa Connect every 10 seconds.
4. Use the CLI tool in the `cli/` directory to inject your desired **Trigger Signal** (`m220`, `gpio0`, or `serial`) into your sliced `.gcode` models.
5. Start your 3D print. 
6. When the print finishes, you can use the dashboard to fetch offline sessions saved on the SD cards or sync PC backups.
7. Click **Compile Video** to generate your cinematic timelapse directly on your desktop!

*(Note: If you prefer a lightweight workflow without the webapp running, check out the `cli/` directory for our command-line tools!)*
