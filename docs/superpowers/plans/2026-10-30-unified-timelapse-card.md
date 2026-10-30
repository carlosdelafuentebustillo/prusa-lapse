# Unified Timelapse Session Card & Compact Sync Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify remote SD and local timelapse cards into a single consistent card format with a compact sync/resume button, clear percentage/frame progress, and conditional display of camera compilation boxes only when local frames exist.

**Architecture:** Extend `webapp/lib/monitor.js` to ensure uniform sync metrics (`totalFramesLocal`, `totalFramesExpected`, `syncPercent`, `remoteSessionIds`) across all session types. Refactor `webapp/app/page.js` to replace split remote vs local rendering and full-width sync banners with an inline compact sync row styled like `Re-compile`, hiding compilation boxes for 0-frame sessions.

**Tech Stack:** Next.js 16 (App Router), React 19, vanilla CSS variables (`--color-orange`, `--color-danger`, `--text-primary`, `--text-secondary`).

**Spec:** [`docs/superpowers/specs/2026-10-30-unified-timelapse-card-design.md`](file:///C:/Users/cafub/Documents/Antigravity/dual-dalmatian/docs/superpowers/specs/2026-10-30-unified-timelapse-card-design.md)

## Global Constraints
* Do not alter ffmpeg compilation or download routes (`/api/captures`, `/api/captures/zip`, `/api/compile`).
* Maintain backward compatibility with existing session metadata and local filesystem layout (`captures/session_*`).
* RULE[user_global]: NEVER run `git push` without explicit user confirmation.

## Review Focus
1. Purely remote session with 0 local frames must NOT show compilation boxes or broken video links.
2. Partially synced session must calculate percentage from local frames vs SD expected frames and offer "Resume Sync".
3. Active synchronization must show real-time progress (`overallProgress`, frames downloaded, per-camera status) inside the compact row without layout jitter.
4. Fully synced sessions must display `✓ Synced` (100%) and leave compilation boxes fully operational.
5. Deleting or renaming a session must remain functional in all sync states.

---

### Task 1: Normalize Session Sync Metrics in Monitor Backend

**Files:**
- Modify: `webapp/lib/monitor.js:1000-1100`
- Test: `tests/monitor-sync-metrics.test.js` (or scratch test script via Node.js)

**Interfaces:**
- Consumes: `getSessions(includeRemote: boolean)`
- Produces: Each returned session object includes:
  - `totalFramesLocal: number`
  - `totalFramesExpected: number`
  - `syncPercentage: number`
  - `remoteSessionIds: Record<string, string>`
  - `remoteFrameCounts: Record<string, number>`

- [ ] **Step 1: Write test script to verify session sync metrics calculation**

Create `webapp/test-sync-metrics.mjs`:
```javascript
import assert from 'node:assert';
import { monitor } from './lib/monitor.js';

const sessions = await monitor.getSessions(false);
for (const s of sessions) {
  assert(typeof s.totalFramesLocal === 'number', `Session ${s.id} missing totalFramesLocal`);
  assert(typeof s.totalFramesExpected === 'number', `Session ${s.id} missing totalFramesExpected`);
  assert(typeof s.syncPercentage === 'number', `Session ${s.id} missing syncPercentage`);
  assert(s.syncPercentage >= 0 && s.syncPercentage <= 100, `Invalid syncPercentage ${s.syncPercentage}`);
}
console.log('Sync metrics test passed for', sessions.length, 'sessions');
```

- [ ] **Step 2: Run test to verify it fails before modification**

Run: `node webapp/test-sync-metrics.mjs`
Expected: FAIL (missing `totalFramesLocal` or `syncPercentage`)

- [ ] **Step 3: Implement metric normalization in `webapp/lib/monitor.js`**

In `webapp/lib/monitor.js`, update `getSessions`:
1. Calculate `totalFramesLocal` from local camera folders:
   `const totalFramesLocal = cameras.reduce((sum, c) => sum + (c.frameCount || 0), 0);`
2. For remote sessions, attach `totalFramesLocal: 0` and `totalFramesExpected: sum(remoteFrameCounts)`.
3. For reconciled local sessions, calculate `syncPercentage = Math.min(100, Math.round((totalFramesLocal / totalFramesExpected) * 100))`.
4. Ensure `remoteSessionIds` and `remoteFrameCounts` are retained on the session object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node webapp/test-sync-metrics.mjs`
Expected: PASS (`Sync metrics test passed`)

- [ ] **Step 5: Clean up test script and commit changes locally**

```bash
git add webapp/lib/monitor.js
git commit -m "feat(monitor): normalize session sync metrics and frame totals"
```

---

### Task 2: Implement Unified Session Card & Compact Sync Row in UI

**Files:**
- Modify: `webapp/app/page.js:705-985`

**Interfaces:**
- Consumes: Session object with `totalFramesLocal`, `totalFramesExpected`, `syncPercentage`, `isRemote`, `isIncomplete`, `isSynced`
- Produces: Single unified `renderSessionCard` with compact sync bar and conditional camera compilation grid

- [ ] **Step 1: Update `renderSessionCard` in `webapp/app/page.js`**

1. Unify session frame counting:
   ```javascript
   const totalFramesLocal = session.totalFramesLocal ?? (session.isRemote ? 0 : (session.cameras || []).reduce((sum, c) => sum + (c.frameCount || 0), 0));
   const totalFramesExpected = session.totalFramesExpected ?? (session.remoteFrameCounts ? Object.values(session.remoteFrameCounts).reduce((a, b) => a + Number(b), 0) : totalFramesLocal);
   const syncPercent = session.syncPercentage ?? (totalFramesExpected > 0 ? Math.min(100, Math.round((totalFramesLocal / totalFramesExpected) * 100)) : (session.isSynced ? 100 : 0));
   ```
2. Replace the separate `session.isRemote ? (...) : (...)` branch with a single card body containing:
   - **Compact Sync Row:**
     - Left: Sync badge (`On Camera SD`, `Partially Synced`, or `✓ Synced`) + Progress indicator (`${syncPercent}% · ${totalFramesLocal} / ${totalFramesExpected} frames`).
     - Progress Bar: A clean, sleek 6px track displaying `${syncPercent}%` fill.
     - Right: Compact button styled like `Compile MP4` / `Re-compile`:
       - If syncing: Spinner + `Syncing… ${syncPercent}%`
       - If $0\%$ local: `Sync from SD`
       - If partial ($0 < \text{local} < \text{expected}$): `Resume Sync`
       - If $100\%$ synced: subtle ghost `Re-sync`
       - Triggers: `handleFetchOffline(session)`
   - Active multi-camera sync details: If syncing and `fetchStatus.cameras` exists, render mini chips (`Corner: 50/100`, `X-Axis: 50/100`).
3. **Conditional Camera Compilation Grid:**
   - Render camera boxes only when `totalFramesLocal > 0`:
     `{totalFramesLocal > 0 && (<div style={{ display: 'grid', ... }}>...</div>)}`
   - When `totalFramesLocal === 0`: Render a neat muted note (`No local frames downloaded yet. Click "Sync from SD" to fetch them.`).

- [ ] **Step 2: Build the webapp to verify compilation and syntax**

Run: `npm --prefix webapp run build`
Expected: `✓ Compiled successfully` with zero syntax or bundling errors.

- [ ] **Step 3: Commit changes locally**

```bash
git add webapp/app/page.js
git commit -m "feat(ui): unify session card with compact sync controls and conditional camera grid"
```

---

### Task 3: End-to-End Verification in Browser & Live Server

**Files:**
- Test via webapp runtime at `http://localhost:3000`

- [ ] **Step 1: Restart webapp server with newly built assets**

Restart Next.js daemon so the new build is served.

- [ ] **Step 2: Verify sessions API response**

Run: `curl -s http://localhost:3000/api/sessions?remote=true`
Expected: Valid JSON with normalized `totalFramesLocal`, `totalFramesExpected`, `syncPercentage`.

- [ ] **Step 3: Check UI rendering in browser**

Verify on `http://localhost:3000`:
- Cards display as a single unified card.
- Compact `Sync from SD` / `Resume Sync` button appears inside the card with progress percentage.
- Camera compilation boxes only appear when local frames are present.
- Fully synced sessions display `✓ Synced` (100%).
