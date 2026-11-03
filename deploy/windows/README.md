# PrusaLapse Portable (Windows x64)

This is a **100% self-contained portable distribution** of PrusaLapse for Windows 10 & 11 (64-bit).

## Zero Installation Required
* **No Node.js needed** (Bundled Node 20 LTS runtime included).
* **No Git or npm needed**.
* **Built-in FFmpeg & Curl included**.

---

## How to Run

1. Extract this `.zip` file anywhere (e.g. `C:\PrusaLapse` or on a USB drive).
2. Double-click **`PrusaLapse.exe`** (or `PrusaLapse.bat`).
3. Your web browser will automatically open to `http://localhost:3000`.

---

## Configuration & Data Storage
All data is stored directly in this folder:
* `app/public/captures/` — All your captured timelapse images and compiled `.mp4` videos.
* `app/prusa-lapse.config.json` — Your printer IP, API keys, and camera preferences.

To backup or move your data, simply copy this folder.
