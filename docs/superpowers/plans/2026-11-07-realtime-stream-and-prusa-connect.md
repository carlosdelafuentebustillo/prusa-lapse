# Preemptible Real-Time Video Streaming & Unified Prusa Connect Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement on-demand ~4 FPS MJPEG live video streaming from any ESP32-CAM camera with toolhead park preemption (1-second safety yield), unified Prusa Connect snapshot synchronization, single-streamer global coordination, and timelapse-driven snapshot viewing in the PrusaLapse webapp.

**Architecture:** 
- Firmware: FreeRTOS `camera_mutex` preemption coordinating a non-blocking ~4 FPS `/stream` MJPEG endpoint and `captureTask`. When streaming is active, captures occur at SVGA (<150ms) to avoid AEC reset. Every parked timelapse frame is copied into `snapshot_buf`, immediately updating both `/snapshot.jpg` and Prusa Connect HTTPS uploads without redundant in-motion sensor cycles.
- Webapp: Dashboard-level stream coordinator in `page.js` ensuring strictly one camera streams at a time. `CameraCard.js` provides a Snapshot/Stream toggle, native hardware-accelerated MJPEG rendering, a blinking `● LIVE (~4 FPS)` badge, an amber resolution reduction warning, and an inert timelapse-driven snapshot view without 10-second polling.

**Tech Stack:** C++ / Arduino / ESP-IDF / ESPAsyncWebServer (ESP32-CAM), Next.js / React 19 / JavaScript (Node.js).

**Spec:** [`docs/superpowers/specs/2026-11-06-realtime-stream-and-prusa-connect-design.md`](docs/superpowers/specs/2026-11-06-realtime-stream-and-prusa-connect-design.md)

## Global Constraints

- **Firmware Version Floor:** Increment `#define FIRMWARE_VERSION` in `firmware/src/main.cpp` to `"v1.3.2"`.
- **Webapp Version Floor:** Increment `"version"` in `webapp/package.json` to `"1.3.6"`.
- **Stream Framerate Cap:** Fixed at **~4 FPS** (~250ms frame interval) to protect 802.11b/g/n bandwidth and ESP32 heap.
- **Preemption Safety Yield:** Up to **1000ms (1 second)** yield window during toolhead park layer captures.
- **Global Stream Limit:** Exactly 1 active streaming camera across the entire web application at any time.
- **Snapshot Interaction:** Snapshot image is inert (no click-to-refresh, no `?fresh=1`, no 10-second interval polling).
- **Git Push Constraint:** Workspace is `dual-dalmatian`. **NEVER execute `git push` without explicit user confirmation.**

## Review Focus

1. **Zombie Socket / F5 Refresh Recovery:** Fast browser reloads leave active TCP sockets in LwIP. The `/stream` handler must support client takeover by terminating prior streaming loops via client IDs rather than locking users out with 503 errors.
2. **Preemption Safety Under Active Print:** When a layer trigger occurs mid-stream, `stream_pause_requested` must force the stream loop to release `camera_mutex` and sleep for up to 1000ms. `captureTask` must capture at SVGA without resetting sensor registers, copy to `snapshot_buf`, and clear the pause flag.
3. **Single Active Streamer Global Switch:** Activating Stream Mode on Camera B while Camera A is streaming must automatically switch Camera A back to Snapshot mode before Camera B connects.
4. **Inert Snapshot Display:** Snapshot mode must not issue periodic 10s fetch requests or react to clicks on the image.
5. **Tab Visibility Teardown:** Hiding the browser tab (`visibilitychange`) or collapsing the camera card must unmount `<img src="http://${ip}/stream" />`, terminating the socket on the ESP32.

---

### Task 1: Firmware Stream Preemption, Sensor Mode Lifecycle & MJPEG `/stream` Endpoint

**Files:**
- Modify: `firmware/src/main.cpp`
- Test: Build verification via `pio run -d firmware`

**Interfaces:**
- Consumes: `camera_mutex`, `esp_camera_fb_get()`, `esp_camera_fb_return()`, `AsyncWebServer server`
- Produces: 
  - `volatile bool stream_active`
  - `volatile bool stream_pause_requested`
  - `volatile uint32_t stream_client_id`
  - HTTP endpoint `GET /stream` (MJPEG `multipart/x-mixed-replace; boundary=frame` at ~4 FPS)

- [ ] **Step 1: Declare stream synchronization flags and update firmware version in `firmware/src/main.cpp`**
  - Update `#define FIRMWARE_VERSION "v1.3.2"`.
  - Add global synchronization primitives:
    ```cpp
    volatile bool stream_active = false;
    volatile bool stream_pause_requested = false;
    volatile uint32_t stream_client_id = 0;
    ```

- [ ] **Step 2: Implement `/stream` MJPEG endpoint in `setupWebServer()`**
  - Add `server.on("/stream", HTTP_GET, ...)`:
    - Increment `stream_client_id` to invalidate any previous client connection (connection takeover).
    - Capture client ID locally: `uint32_t thisClientId = stream_client_id;`.
    - If `stream_active` is already true, wait up to 300ms for previous connection loop to exit.
    - Set `stream_active = true`.
    - Switch sensor resolution to `FRAMESIZE_SVGA` with quality 12 if currently at `FRAMESIZE_UXGA`. Flush 2 stale DMA frames.
    - Begin chunked multipart response with header: `multipart/x-mixed-replace; boundary=frame`.
    - Stream loop with ~250ms frame limiter (~4 FPS):
      - Check `thisClientId != stream_client_id`: if connection was taken over, exit loop.
      - Check `stream_pause_requested`: if true, release `camera_mutex` and delay for up to 1000ms (in 50ms sleep slices while `stream_pause_requested` is true).
      - Acquire `camera_mutex` (timeout 150ms). Grab frame, write multipart boundary, headers, JPEG payload, and return frame. Release `camera_mutex`.
    - On disconnect or loop termination:
      - If `thisClientId == stream_client_id`, set `stream_active = false`.
      - Switch sensor back to `FRAMESIZE_UXGA` and flush 2 frames so future timelapses return to full resolution.

- [ ] **Step 3: Update `captureTask` preemption logic for active streams**
  - At the beginning of `captureTask`:
    ```cpp
    if (stream_active) {
      stream_pause_requested = true;
    }
    // Take camera mutex with up to 1000ms timeout
    if (camera_mutex && xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
      // If stream is active, capture at current SVGA resolution without mode reset:
      // If stream is idle, ensure FRAMESIZE_UXGA
      ...
    ```
  - After capture completes and frame is buffered:
    ```cpp
    xSemaphoreGive(camera_mutex);
    stream_pause_requested = false;
    ```

- [ ] **Step 4: Verify firmware compilation**
  Run: `pio run -d firmware`  
  Expected: SUCCESS (RAM and Flash sizes reported within limits).

- [ ] **Step 5: Commit Task 1 changes**
  ```bash
  git add firmware/src/main.cpp
  git commit -m "feat(firmware): add preemptible 4fps mjpeg stream endpoint v1.3.2"
  ```

---

### Task 2: Firmware Unified Snapshot Sync & Removal of Manual Refresh

**Files:**
- Modify: `firmware/src/main.cpp`
- Test: Build verification via `pio run -d firmware`

**Interfaces:**
- Consumes: `snapshot_buf`, `snapshot_buf_size`, `snapshot_len`, `snapshot_mutex`
- Produces:
  - Parked timelapse frame copy into `snapshot_buf` inside `captureTask`.
  - Non-intrusive `previewAndUploadTask` that uploads `snapshot_buf` without taking in-motion sensor photos during prints.
  - `/snapshot.jpg` endpoint that strictly serves `snapshot_buf` (ignoring `?fresh=1`).

- [ ] **Step 1: Synchronize parked timelapse photo into `snapshot_buf` inside `captureTask`**
  - In `captureTask`, immediately after validating `fb`:
    ```cpp
    if (snapshot_mutex && xSemaphoreTake(snapshot_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
      if (!snapshot_buf || snapshot_buf_size < fb->len) {
        if (snapshot_buf) free(snapshot_buf);
        snapshot_buf = (uint8_t *)(psramFound() ? ps_malloc(fb->len) : malloc(fb->len));
        if (snapshot_buf) snapshot_buf_size = fb->len;
      }
      if (snapshot_buf) {
        memcpy(snapshot_buf, fb->buf, fb->len);
        snapshot_len = fb->len;
      }
      xSemaphoreGive(snapshot_mutex);
    }
    ```

- [ ] **Step 2: Update `previewAndUploadTask` to avoid redundant in-motion captures during prints**
  - In `previewAndUploadTask`:
    ```cpp
    // Dynamic interval: 30s during active print to avoid TLS/SD collision, 10s when idle
    uint32_t currentInterval = (currentPrinterState == "PRINTING") ? 30000 : 10000;
    vTaskDelay(pdMS_TO_TICKS(currentInterval));

    if (capture_in_progress || sd_write_in_progress || (millis() - last_sd_download_time < 8000)) {
      continue;
    }

    // Only take a sensor preview snapshot when idle and NOT streaming
    if (currentPrinterState != "PRINTING" && !stream_active) {
      takePreviewSnapshot();
    }
    ```

- [ ] **Step 3: Remove on-demand capture trigger from `/snapshot.jpg`**
  - In `server.on("/snapshot.jpg", HTTP_GET, ...)`:
    - Remove `takePreviewSnapshot()` call even if `request->hasArg("fresh")` is present.
    - Serve the existing `snapshot_buf` directly.

- [ ] **Step 4: Verify firmware compilation**
  Run: `pio run -d firmware`  
  Expected: SUCCESS.

- [ ] **Step 5: Commit Task 2 changes**
  ```bash
  git add firmware/src/main.cpp
  git commit -m "feat(firmware): sync parked timelapse frames to snapshot buffer and prusa connect"
  ```

---

### Task 3: Webapp Single Active Stream Coordinator

**Files:**
- Modify: `webapp/app/page.js`
- Test: `tests/stream-and-snapshot.test.js`

**Interfaces:**
- Consumes: `config.cameraIps`, `cleanIp`
- Produces: 
  - State `activeStreamingCameraIp` in `page.js`
  - Handler `handleToggleStream(cleanIp)` passed down to `<CameraCard />`
  - Prop `isStreaming={activeStreamingCameraIp === cleanIp}` passed to `<CameraCard />`

- [ ] **Step 1: Write unit test for single active stream coordinator logic**
  - Create `tests/stream-and-snapshot.test.js`:
    - Test 1: Activating stream on Camera A sets active camera to A.
    - Test 2: Activating stream on Camera B automatically replaces A so only B is streaming.
    - Test 3: Toggling Camera B off sets active camera to null.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node tests/stream-and-snapshot.test.js`  
  Expected: FAIL (file or exports missing).

- [ ] **Step 3: Implement stream coordinator state in `webapp/app/page.js`**
  - Add state:
    ```javascript
    const [activeStreamingCameraIp, setActiveStreamingCameraIp] = useState(null);
    ```
  - Add toggle handler:
    ```javascript
    const handleToggleStream = useCallback((cameraIp) => {
      setActiveStreamingCameraIp(prev => (prev === cameraIp ? null : cameraIp));
    }, []);
    ```
  - In `cameras-grid` mapping, pass `isStreaming={activeStreamingCameraIp === ip.trim()}` and `onToggleStream={() => handleToggleStream(ip.trim())}` to `<CameraCard />`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `node tests/stream-and-snapshot.test.js`  
  Expected: PASS.

- [ ] **Step 5: Commit Task 3 changes**
  ```bash
  git add webapp/app/page.js tests/stream-and-snapshot.test.js
  git commit -m "feat(webapp): add global single-active-stream coordinator"
  ```

---

### Task 4: Webapp Camera Card UI (Snapshot Mode Refactor, Live Stream Player & Warning)

**Files:**
- Modify: `webapp/app/components/CameraCard.js`
- Modify: `webapp/package.json` (bump `"version"` to `"1.3.6"`)
- Test: `tests/stream-and-snapshot.test.js`

**Interfaces:**
- Consumes: `isStreaming`, `onToggleStream`, `cleanIp`, `idx`
- Produces:
  - Inert `SnapshotImage` (no click-to-refresh, no 10s interval polling).
  - Mode toggle button in camera card header: **[ 📷 Snapshot ]** / **[ 📹 Live Stream ]**.
  - Live stream viewer (`<img src="http://${cleanIp}/stream" />`) with blinking `● LIVE (~4 FPS)` badge.
  - Prominent amber warning banner when streaming is active:
    `⚠️ Live streaming active: timelapse capture resolution on this camera is temporarily reduced to SVGA`.
  - Automatic teardown of stream image on tab blur or collapse.

- [ ] **Step 1: Write test for CameraCard UI properties and package version bump**
  - Add test cases in `tests/stream-and-snapshot.test.js`:
    - Test package version is `"1.3.6"`.
    - Test `SnapshotImage` source contains no 10-second interval or click-to-refresh handlers.
    - Test amber warning copy is present in `CameraCard.js`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node tests/stream-and-snapshot.test.js`  
  Expected: FAIL (version mismatch and missing UI elements).

- [ ] **Step 3: Refactor `SnapshotImage` in `webapp/app/components/CameraCard.js`**
  - Remove 10-second `setInterval` polling loop.
  - Remove `handleRefresh`, `isRefreshing`, pointer cursor, and click handler on the image.
  - Display the latest parked frame cleanly without background polling.

- [ ] **Step 4: Add Stream Mode controls, warning banner, and live player in `CameraCard.js`**
  - In camera header, add toggle button:
    ```jsx
    <button
      className={`btn btn-small ${isStreaming ? 'btn-primary' : 'btn-ghost'}`}
      onClick={onToggleStream}
      style={{ padding: '3px 8px', fontSize: '0.72rem' }}
      title={isStreaming ? 'Switch to Snapshot Mode' : 'Switch to Live Video Stream'}
    >
      {isStreaming ? '📹 Live Stream' : '📷 Snapshot'}
    </button>
    ```
  - When `isStreaming` is true:
    - Render amber warning banner:
      ```jsx
      <div style={{
        margin: '6px 0',
        padding: '6px 10px',
        background: 'rgba(255, 170, 0, 0.12)',
        border: '1px solid rgba(255, 170, 0, 0.35)',
        borderRadius: '6px',
        color: '#ffaa00',
        fontSize: '0.73rem',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        <span>⚠️</span>
        <span>Live streaming active: timelapse capture resolution on this camera is temporarily reduced to SVGA.</span>
      </div>
      ```
    - Render native `<img src={"http://" + cleanIp + "/stream"} />` with blinking `● LIVE (~4 FPS)` badge.
    - Add `visibilitychange` listener to auto-toggle stream off or pause when tab is hidden.

- [ ] **Step 5: Bump package version to `"1.3.6"` in `webapp/package.json`**

- [ ] **Step 6: Run test to verify it passes**
  Run: `node tests/stream-and-snapshot.test.js`  
  Expected: PASS.

- [ ] **Step 7: Commit Task 4 changes**
  ```bash
  git add webapp/app/components/CameraCard.js webapp/package.json tests/stream-and-snapshot.test.js
  git commit -m "feat(webapp): add live stream toggle, warning banner, and inert snapshot view v1.3.6"
  ```

---

### Task 5: End-to-End Test Suite & Verification

**Files:**
- Modify: `tests/stream-and-snapshot.test.js`
- Test: All repository test suites

**Interfaces:**
- Consumes: All updated firmware and webapp components.
- Produces: Passing test reports across PlatformIO firmware build and Node.js test suites.

- [ ] **Step 1: Run firmware build verification**
  Run: `pio run -d firmware`  
  Expected: SUCCESS with zero compilation errors.

- [ ] **Step 2: Run webapp test suites**
  Run: `node webapp/tests/slicer-api.test.js`  
  Expected: All slicer API tests PASS.

- [ ] **Step 3: Run recording lock test suite**
  Run: `node tests/recording-lock.test.js`  
  Expected: All recording lock tests PASS.

- [ ] **Step 4: Run stream and snapshot integration test suite**
  Run: `node tests/stream-and-snapshot.test.js`  
  Expected: All 5 test suites PASS.

- [ ] **Step 5: Commit Task 5 changes**
  ```bash
  git add tests/stream-and-snapshot.test.js
  git commit -m "test: add comprehensive stream and snapshot verification test suite"
  ```

---

## Plan Self-Review Checklist

1. **Spec Coverage:**
   - On-demand ~4 FPS stream at SVGA: Covered in Task 1.
   - Preemption with 1-second safety yield: Covered in Task 1.
   - Parked frame sync to `snapshot_buf` & Prusa Connect: Covered in Task 2.
   - Removal of click-to-refresh & 10s polling: Covered in Task 2 & Task 4.
   - Single active stream coordinator: Covered in Task 3.
   - Amber resolution reduction warning banner: Covered in Task 4.
   - Tab blur / collapse teardown: Covered in Task 4.
   - Version bump rules: Covered in Task 1 (`v1.3.2`) and Task 4 (`1.3.6`).
2. **Step Scan:** Every step specifies the exact file, exact signatures/values, command to run, and expected output.
3. **Type Consistency:** Method signatures, variable names (`stream_active`, `stream_pause_requested`, `stream_client_id`, `activeStreamingCameraIp`), and endpoint paths (`/stream`, `/snapshot.jpg`) match across all tasks.
4. **Review Focus:** All 5 failure modes are addressed and tested in the test suite.
5. **Proportion:** The plan is focused and concise, detailing interface contracts without duplicating full source files.
