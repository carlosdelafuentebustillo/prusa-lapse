# Design: Preemptible Real-Time Video Streaming & Unified Prusa Connect Sync

**Date:** 2026-11-06  
**Author:** Antigravity & User  
**Status:** Approved with User Refinements (Approach 2)  

---

## 1. Intent & Why
Users want continuous real-time video monitoring to visually track 3D print progress directly within the PrusaLapse dashboard, while preserving dual-camera parked timelapses.

In addition, snapshot mode previously relied on continuous 10-second polling and allowed manual click-to-refresh (`?fresh=1`), triggering separate in-motion photo captures that cause motion blur in Prusa Connect uploads and contend for camera sensor hardware. 

Under this design:
1. **Timelapse-Driven Snapshots**: Snapshot mode removes the 10-second polling cycle and removes on-demand click-to-refresh. Instead, the snapshot preview displays the latest parked UXGA frame captured for the timelapse.
2. **Unified Prusa Connect Sync**: Whenever a parked timelapse photo is captured, it immediately updates `snapshot_buf`. Prusa Connect and `/snapshot.jpg` immediately receive clean, motion-blur-free parked photos, eliminating redundant sensor cycles and preventing motion blur during prints.
3. **On-Demand Single-Camera Live Stream**: Users can switch any camera into live video mode capped at **~4 FPS**. To protect Wi-Fi bandwidth and ESP32 resources, activating stream mode on one camera automatically switches all other cameras back to snapshot mode first.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
* **Real-time Live Stream on Any Camera**: Provide an on-demand MJPEG stream (`/stream`) from any ESP32-CAM capped at **~4 FPS** (~250ms frame interval) at SVGA (800×600) with adjusted JPEG compression.
* **Single Active Streamer Globally**: Only one camera can stream video at any given time across the entire webapp. Enabling stream mode on one camera automatically switches all other cameras to snapshot mode before starting the new stream.
* **Timelapse Capture Preemption with 1s Safety Yield**: When a layer trigger (`/action_capture` or automatic Z-poll trigger) fires, the streaming loop yields sensor access (`camera_mutex`) and pauses for up to **1000ms (1 second)** to guarantee that `captureTask` has generous time to acquire the sensor, capture the parked frame, update `snapshot_buf`, and wake the SD writer task before streaming resumes.
* **Resolution Warning in WebApp**: Whenever stream mode is enabled on a camera, display a prominent warning informing the user that timelapse capture resolution on that specific camera is reduced to SVGA while streaming is active.
* **Timelapse-Driven Snapshot View (No 10s Polling, No Click-to-Refresh)**: Snapshot mode no longer polls every 10 seconds, and on-demand click-to-refresh (`?fresh=1`) is removed. The snapshot view cleanly reflects the latest parked UXGA frame taken for the timelapse.
* **Unified Prusa Connect Snapshot Buffer**: Whenever a parked timelapse frame is captured, copy it to `snapshot_buf`. Prusa Connect and `/snapshot.jpg` instantly serve the sharp, parked frame.
* **Socket & Memory Safety**: Restrict concurrent stream clients per camera to 1 with reconnect takeover to prevent AsyncTCP socket exhaustion and heap starvation on the ESP32.

### Non-Goals
* 4K, 1080p60, or H.264/WebRTC encoding (unsupported by ESP32-CAM hardware limits).
* Concurrent multi-camera live video streaming (anti-bandwidth, saturates 802.11b/g/n Wi-Fi and ESP32 heap).
* Audio streaming.
* Streaming during bulk SD sync (bulk sync actions remain locked during recording).

### Anti-Goals
* Never let live video streaming cause dropped timelapse frames or SD write corruption.
* Never leave open zombie HTTP stream connections on the ESP32 when a browser tab closes or refreshes.
* Never allow manual click-to-refresh or 10s interval polling to interrupt active printing or timelapse captures.

---

## 3. Constraints & Hardware Realities
* **Shared Camera Pipeline**: The OV2640 sensor on the ESP32-CAM has a single frame buffer output (`esp_camera_fb_get()`).
* **Sensor Calibration & Resolution Switching**: Dynamic resolution changes between UXGA and lower resolutions reset OV2640 AEC/AGC/AWB registers and require flushing DMA frames. When live streaming is active, the sensor operates in SVGA (800×600). To avoid green frame anomalies during printing, layer captures while streaming is active capture at SVGA (<150ms). When streaming is idle, layer captures operate at full UXGA (1600×1200).
* **Wi-Fi Throughput & Framerate Cap**: Wi-Fi bandwidth on the ESP32 is shared with PrusaLink polling and SD card operations. Stream framerate is strictly capped at **~4 FPS** (~250ms frame delay) to ensure absolute stability and minimal CPU/network load.

---

## 4. Approaches Considered

* **Approach 1: Dedicated Camera Roles (Streamer vs Timelapse Recorder)**:
  * Camera 1 dedicated solely to streaming; Camera 2 dedicated to timelapse recording.
  * *Trade-off*: Disallows dual-angle timelapses.
* **Approach 2: Preemptible Hybrid Stream on Any Camera (Selected by User)**:
  * Any camera can stream video on demand, capped at ~4 FPS. During layer changes, the stream yields sensor access for up to **1000ms (1 second)** while the parked timelapse photo is captured to SD and synced to Prusa Connect, then resumes streaming.
  * *Trade-off*: Stream momentarily pauses during layer changes (a visual cue that a layer photo is being taken), and timelapse resolution on the streaming camera is SVGA while streaming is active.
* **Approach 3: Rapid Snapshot Polling (1–3 FPS)**:
  * Rapid back-to-back `/snapshot.jpg` requests from the client.
  * *Trade-off*: Choppy framerate and high HTTP header overhead.

---

## 5. Specification & Implementation Details

### A. Firmware Layer (`firmware/src/main.cpp`)

1. **Preemption Coordination & Sensor Resolution Lifecycle**:
   * Global flags:
     * `volatile bool stream_active = false;`
     * `volatile bool stream_pause_requested = false;`
     * `volatile uint32_t stream_client_id = 0;`
   * **Sensor Resolution Lifecycle**:
     * **Idle Mode (No active stream)**: OV2640 sensor stays at full `FRAMESIZE_UXGA` (1600×1200). All layer timelapse captures and periodic snapshots are captured at maximum resolution.
     * **Active Stream Mode**: Upon client connection to `/stream`, sensor switches to `FRAMESIZE_SVGA` (800×600) with JPEG quality 12. At 800×600 and ~4 FPS, bandwidth is ~100–160 KB/sec, ensuring rock-solid Wi-Fi stability.
     * **Preemption During Active Stream**: When a layer trigger occurs (`captureTask`), it sets `stream_pause_requested = true`. The stream loop yields `camera_mutex` and pauses for **1000ms** (or until `stream_pause_requested` is cleared). `captureTask` captures the parked frame at SVGA without resetting sensor registers, copies it to `snapshot_buf`, queues SD write, releases `camera_mutex`, and clears `stream_pause_requested`. Total capture time is <150ms.
     * **Stream Teardown**: When the stream disconnects, the sensor switches back to `FRAMESIZE_UXGA` and flushes 2 frames so future timelapses return to full UXGA resolution.
   * In `captureTask`:
     ```cpp
     stream_pause_requested = true;
     // Wait up to 1000ms for active stream loop to yield camera_mutex
     if (xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
       // Perform parked timelapse capture (SVGA if streaming, UXGA if idle)
       camera_fb_t *fb = esp_camera_fb_get();
       if (fb) {
         // Direct Prusa Connect & Preview Sync:
         if (snapshot_mutex && xSemaphoreTake(snapshot_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
           if (snapshot_buf && snapshot_buf_size >= fb->len) {
             memcpy(snapshot_buf, fb->buf, fb->len);
             snapshot_len = fb->len;
           }
           xSemaphoreGive(snapshot_mutex);
         }
         // Wake SD writer task
         ...
       }
       xSemaphoreGive(camera_mutex);
     }
     stream_pause_requested = false;
     ```

2. **MJPEG Stream Endpoint (`/stream`) & Connection Takeover**:
   * Serves standard `multipart/x-mixed-replace; boundary=frame`.
   * Loops grabbing frames with a frame limiter: **~4 FPS** (~250ms delay between frames).
   * Checks `stream_pause_requested`: if true, releases `camera_mutex` and sleeps for up to **1000ms** to allow `captureTask` full priority.
   * **Connection Takeover / Zombie Recovery**: If an incoming `/stream` connection arrives while a prior client is recorded (such as following a browser page refresh F5 or quick tab switch), the old connection is terminated and the new connection takes over seamlessly, preventing spurious `503 Busy` lockouts.
   * On client disconnect, terminates loop, releases mutex, restores UXGA mode, and frees memory.

3. **Prusa Connect Direct Sync & Snapshot Endpoint**:
   * In `server.on("/snapshot.jpg")`: Remove or ignore the `?fresh=1` query argument so clients cannot force unexpected sensor captures. The endpoint strictly serves the current `snapshot_buf` (which contains the latest parked UXGA frame).
   * In `previewAndUploadTask`:
     * During active prints (`currentPrinterState == "PRINTING"`), does not trigger standalone sensor captures. It uploads the latest parked frame already stored in `snapshot_buf`.
     * When `stream_active` is true, skips redundant `takePreviewSnapshot()` sensor calls.

---

### B. WebApp Layer (`webapp/app/components/CameraCard.js` & `webapp/app/page.js`)

1. **Single Active Stream Coordinator (`page.js`)**:
   * Manage active streaming camera state at the dashboard level: `activeStreamingCameraIp` (string or null).
   * When switching any camera into Live Stream mode:
     * Check if another camera is currently streaming.
     * If yes, automatically switch the prior camera back to Snapshot mode first.
     * Then activate Live Stream mode on the selected camera.
   * Only one camera can stream at any time across the entire application.

2. **Camera Card Stream Controls, Telemetry & Resolution Warning**:
   * Add a toggle button on each camera card: **[ 📷 Snapshot ]** / **[ 📹 Live Stream ]**.
   * In "Snapshot" mode:
     * **No 10-second polling cycle**: The snapshot image does not poll on an interval. It updates when a new layer is captured/announced, when a session is updated, or on component load.
     * **No click-to-refresh**: Remove `onClick` from the snapshot image, remove cursor pointer, remove hover refresh glow, and remove "Click to capture a fresh snapshot" tooltip.
   * In "Live Stream" mode:
     * **Resolution Warning Banner**: Display a prominent amber warning badge/callout above or below the video:
       `⚠️ Live streaming active: timelapse capture resolution on this camera is temporarily reduced to SVGA`.
     * **Video Rendering**: Renders native `<img src="http://${ip}/stream" />` for hardware-accelerated decoding.
     * **Telemetry Badge**: Displays a blinking green `● LIVE (~4 FPS)` badge.
     * Handles `onError` and `onLoad` with automatic fallback to snapshots if camera stream is disconnected.
   * **Bandwidth & Socket Protection**:
     * When the browser tab is hidden (`document.visibilityState === 'hidden'`) or the camera card is collapsed or switched back to snapshot mode, the `<img src>` is immediately unmounted/cleared, closing the TCP socket on the ESP32.

3. **Snapshot Sync Benefit**:
   * In both modes, `/snapshot.jpg` immediately reflects the parked UXGA timelapse photo whenever a layer completes, giving the webapp a motion-blur-free view of the print bed.

---

## 6. What Is Left to the Builder
* Exact UI layout and styling for the amber resolution warning callout within `CameraCard.js`.
* Exact placement of the `[ 📷 Snapshot ]` / `[ 📹 Live Stream ]` toggle buttons in the camera card header/action row.

---

## 7. Verification & Test Plan
1. **Single Active Stream Switching**:
   * Activate Live Stream on Camera 1. Verify Camera 1 streams at ~4 FPS.
   * Activate Live Stream on Camera 2. Verify Camera 1 automatically reverts to Snapshot mode and Camera 2 begins streaming.
2. **Snapshot Mode Behavior**:
   * Verify clicking the snapshot image does not trigger a fresh snapshot or send `?fresh=1`.
   * Verify the network panel shows no 10-second polling requests for `/snapshot.jpg`.
   * Verify the snapshot image updates when a timelapse layer photo is captured.
3. **Preemption & 1-Second Safety Yield**:
   * While actively streaming video on a camera, trigger `/action_capture`.
   * Verify the stream yields cleanly, the parked frame is saved to SD card without corruption, and the stream resumes after capture completes.
4. **Resolution Warning Display**:
   * Verify the amber warning banner is visible when Live Stream mode is enabled and hidden in Snapshot mode.
5. **PlatformIO Build & Webapp Tests**:
   * Compile firmware with `pio run -d firmware`.
   * Run unit test suite `node webapp/tests/slicer-api.test.js` and `node tests/recording-lock.test.js`.
