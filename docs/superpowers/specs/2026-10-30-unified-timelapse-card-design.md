# Design: Unified Timelapse Session Card & Compact Sync Controls

**Date:** 2026-10-30  
**Author:** Antigravity & User  
**Status:** Approved (Approach A selected)

---

## 1. Intent & Why
Currently, timelapse sessions exist in two distinct card visual formats:
1. Purely remote sessions on the camera SD card render an empty, barebones card with a massive 100%-width banner button (`Sync Session from Camera SD`).
2. Local sessions render camera compilation grids, but if incomplete, another massive 100%-width orange banner button is placed above the grid.

The goal is to consolidate both representations into **one single, unified card** per print. The card will cleanly convey sync status and percentage, feature a compact button (styled like `Re-compile`) for starting/resuming synchronization, and display the camera compilation boxes only once local frames are present.

---

## 2. Goals, Non-Goals & Anti-Goals
* **Goals:**
  * One single card representation for every print session across SD-only, partially synced, and fully synced states.
  * Clear sync percentage and frame progress indicators (`X% · Y / Z frames`).
  * Replace full-width banner buttons with a compact action button styled like `Re-compile` / `Compile MP4` (`btn btn-small`, `width: auto`) that handles both initial sync and resume sync.
  * Conditionally display camera compilation blocks only when local frames exist ($>0$).
* **Non-Goals:**
  * Rewriting the underlying camera-to-server HTTP file fetcher or tar packer.
  * Altering video compilation logic (ffmpeg, 30 FPS, rotations).
* **Anti-Goals:**
  * Do not display disabled or empty camera compilation boxes for sessions with 0 local frames.
  * Do not retain giant, screen-filling sync banners.

---

## 3. Constraints
* Must preserve all existing session operations: renaming, metadata display (filament, layer height, date), video playback, MP4 download, RAW frames ZIP download, and deletion.
* Real-time sync feedback (frames fetched, percentage, active spinner) must remain smooth and responsive.

---

## 4. Approaches Considered
* **Approach A: Dedicated Sync & Status Row inside the card (Chosen):**
  * A dedicated compact strip inside the card body containing the sync badge, progress bar (`X% · Y / Z frames`), and the compact `Sync from SD` / `Resume Sync` button.
  * Camera compilation grid renders underneath only when local frames exist.
  * *Reason chosen:* Intuitive, clean visual balance, avoids cluttering the top metadata header while keeping progress legible.
* **Approach B: Ultra-Compact Header Action Cluster:**
  * Compresses the sync button into the top title/date row with a subtle top accent progress line.
  * *Trade-off:* Too cramped during active downloading; lacks space for per-camera progress breakdown.

---

## 5. Specification & Implementation Details

### A. Data Layer (`webapp/lib/monitor.js`)
* In `getSessions()`, ensure every session object provides consistent sync metrics:
  * `totalFramesLocal`: Sum of existing frames across all `camera_X` directories on disk.
  * `totalFramesExpected`: Total frames recorded in SD card `sessions.jsonl`.
  * `syncPercentage`: Computed as `Math.min(100, Math.round((totalFramesLocal / totalFramesExpected) * 100))`.
  * `syncState`: `'synced'` (100%), `'partial'` ($0 < \text{local} < \text{expected}$), or `'remote'` (0 frames local).
* Ensure remote sessions seamlessly map to local sessions when partially synced so no duplicates ever appear.

### B. UI Layer (`webapp/app/page.js`)
* In `renderSessionCard(session)`:
  1. **Header:** Retains thumbnail, title, rename input, material/layer tags, date, and Delete button.
  2. **Card Body - Compact Sync Row:**
     * Status indicator: Badge indicating state (`✓ Synced`, `Partially Synced (X%)`, or `On Camera SD`).
     * Progress info: Mini progress bar + text (`X% · Y / Z frames downloaded`).
     * Compact Button (`btn btn-small`, `width: auto`):
       * If $0\%$ local: `"Sync from SD"` (primary or secondary button).
       * If partial: `"Resume Sync"`.
       * If actively syncing: Spinner + `"Syncing... X%"`.
       * If $100\%$ synced: Optionally a subtle `"Re-sync"` or omitted.
  3. **Camera Grid:**
     * Conditionally rendered: `(totalFramesLocal > 0) && (<div className="camera-grid">...</div>)`.
     * Houses rotation selector, `Play`, `Compile MP4` / `Re-compile`, `MP4 ↓`, and `ZIP ↓`.
