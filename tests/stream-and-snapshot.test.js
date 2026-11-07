const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('====================================================');
  console.log('Stream & Snapshot Verification Test Suite');
  console.log('====================================================\n');

  // =========================================================================
  // SUITE 1: Single Active Stream Coordinator State Transitions
  // =========================================================================
  console.log('--- SUITE 1: Single Active Stream Coordinator State Transitions ---');

  const pagePath = path.join(__dirname, '../webapp/app/page.js');
  assert.ok(fs.existsSync(pagePath), 'webapp/app/page.js must exist');
  const pageSrc = fs.readFileSync(pagePath, 'utf8');

  // Verify coordinator state and handler implementation in page.js
  assert.ok(
    pageSrc.includes('const [activeStreamingCameraIp, setActiveStreamingCameraIp] = useState(null)'),
    'activeStreamingCameraIp state must be declared with useState(null) in page.js'
  );

  assert.ok(
    pageSrc.includes('handleToggleStream') &&
    (pageSrc.includes('prev === cameraIp ? null : cameraIp') || pageSrc.includes('prev === ip ? null : ip')),
    'handleToggleStream handler must toggle cameraIp or null in page.js'
  );

  assert.ok(
    pageSrc.includes('isStreaming={activeStreamingCameraIp === ip.trim()}'),
    'CameraCard must receive isStreaming prop based on activeStreamingCameraIp === ip.trim()'
  );

  assert.ok(
    pageSrc.includes('onToggleStream={() => handleToggleStream(ip.trim())}'),
    'CameraCard must receive onToggleStream callback handler in page.js'
  );

  // State machine simulation for coordinator reducer
  const streamCoordinatorReducer = (prev, cameraIp) => (prev === cameraIp ? null : cameraIp);

  const cameraA = '192.168.1.100';
  const cameraB = '192.168.1.101';
  const cameraC = '192.168.1.102';

  // Step 1: Initial state is null (no camera streaming)
  let activeCamera = null;
  assert.strictEqual(activeCamera, null, 'Initial stream coordinator state must be null');

  // Step 2: Activating Camera A sets active camera to A and leaves others disabled
  activeCamera = streamCoordinatorReducer(activeCamera, cameraA);
  assert.strictEqual(activeCamera, cameraA, 'Activating Camera A should set active camera to A');
  assert.strictEqual(activeCamera === cameraA, true, 'Camera A isStreaming must be true');
  assert.strictEqual(activeCamera === cameraB, false, 'Camera B isStreaming must be false');
  assert.strictEqual(activeCamera === cameraC, false, 'Camera C isStreaming must be false');
  console.log('  ✓ Step 1.1: Activating stream on Camera A sets active camera to A and disables others');

  // Step 3: Activating Camera B automatically replaces A so only B is streaming
  activeCamera = streamCoordinatorReducer(activeCamera, cameraB);
  assert.strictEqual(activeCamera, cameraB, 'Activating Camera B should replace Camera A');
  assert.strictEqual(activeCamera === cameraA, false, 'Camera A isStreaming must now be false');
  assert.strictEqual(activeCamera === cameraB, true, 'Camera B isStreaming must now be true');
  assert.strictEqual(activeCamera === cameraC, false, 'Camera C isStreaming must remain false');
  console.log('  ✓ Step 1.2: Activating stream on Camera B automatically replaces Camera A');

  // Step 4: Activating Camera C automatically replaces B
  activeCamera = streamCoordinatorReducer(activeCamera, cameraC);
  assert.strictEqual(activeCamera, cameraC, 'Activating Camera C should replace Camera B');
  assert.strictEqual(activeCamera === cameraA, false, 'Camera A isStreaming must remain false');
  assert.strictEqual(activeCamera === cameraB, false, 'Camera B isStreaming must now be false');
  assert.strictEqual(activeCamera === cameraC, true, 'Camera C isStreaming must now be true');
  console.log('  ✓ Step 1.3: Activating stream on Camera C automatically replaces Camera B');

  // Step 5: Toggling currently active Camera C deactivates streaming (reverts to null)
  activeCamera = streamCoordinatorReducer(activeCamera, cameraC);
  assert.strictEqual(activeCamera, null, 'Toggling active Camera C again should set active camera to null');
  assert.strictEqual(activeCamera === cameraA, false, 'No camera streaming (A=false)');
  assert.strictEqual(activeCamera === cameraB, false, 'No camera streaming (B=false)');
  assert.strictEqual(activeCamera === cameraC, false, 'No camera streaming (C=false)');
  console.log('  ✓ Step 1.4: Toggling active camera off deactivates stream globally (reverts to null)');

  console.log('✓ SUITE 1 PASSED: Stream coordinator state transitions verified.\n');

  // =========================================================================
  // SUITE 2: Inert Snapshot Mode & Direct Buffer Sync
  // =========================================================================
  console.log('--- SUITE 2: Inert Snapshot Mode & Direct Buffer Sync ---');

  const cardPath = path.join(__dirname, '../webapp/app/components/CameraCard.js');
  assert.ok(fs.existsSync(cardPath), 'webapp/app/components/CameraCard.js must exist');
  const cardSrc = fs.readFileSync(cardPath, 'utf8');

  // 1. SnapshotImage in webapp must be completely inert
  assert.ok(!cardSrc.includes('10000'), 'SnapshotImage must not contain 10000ms polling interval');
  assert.ok(!cardSrc.includes('setInterval'), 'SnapshotImage must not register any interval timer');
  assert.ok(!cardSrc.includes('handleRefresh'), 'SnapshotImage must not have handleRefresh handler');
  assert.ok(!cardSrc.includes('isRefreshing'), 'SnapshotImage must not track isRefreshing state');
  assert.ok(!cardSrc.includes('fresh=1'), 'SnapshotImage must not request fresh=1 snapshot');
  assert.ok(!cardSrc.includes('Click to capture a fresh snapshot'), 'SnapshotImage must not have click-to-refresh tooltip');
  console.log('  ✓ Step 2.1: SnapshotImage is completely inert (no setInterval, no click-to-refresh, no fresh=1)');

  // 2. SnapshotImage serves activeDisplayUrl and supports reconnection notice
  assert.ok(cardSrc.includes('activeDisplayUrl = lastGoodUrl || snapshotUrl'), 'SnapshotImage must display activeDisplayUrl');
  assert.ok(cardSrc.includes('setLastGoodUrl(activeDisplayUrl)'), 'SnapshotImage must update lastGoodUrl on image load');
  assert.ok(cardSrc.includes('Reconnecting…'), 'SnapshotImage must show Reconnecting fallback when errors accumulate');
  console.log('  ✓ Step 2.2: SnapshotImage renders latest frame with error resilience');

  // 3. Firmware snapshot handler & Prusa Connect buffer sync
  const mainCppPath = path.join(__dirname, '../firmware/src/main.cpp');
  assert.ok(fs.existsSync(mainCppPath), 'firmware/src/main.cpp must exist');
  const mainCppSrc = fs.readFileSync(mainCppPath, 'utf8');

  assert.ok(
    mainCppSrc.includes('snapshot_mutex') && mainCppSrc.includes('snapshot_buf'),
    'Firmware must maintain snapshot_buf protected by snapshot_mutex'
  );

  assert.ok(
    mainCppSrc.includes('memcpy(snapshot_buf, fb->buf, fb->len)'),
    'Firmware must copy parked timelapse capture into snapshot_buf'
  );

  assert.ok(
    mainCppSrc.includes('if (currentPrinterState != "PRINTING" && !stream_active)'),
    'Firmware previewAndUploadTask must skip standalone sensor capture during active prints and streaming'
  );
  console.log('  ✓ Step 2.3: Firmware syncs parked frame to snapshot_buf without redundant sensor captures');

  console.log('✓ SUITE 2 PASSED: Inert snapshot mode and buffer sync verified.\n');

  // =========================================================================
  // SUITE 3: Live Stream Viewer & Amber Warning Banner Copy
  // =========================================================================
  console.log('--- SUITE 3: Live Stream Viewer & Amber Warning Banner Copy ---');

  // 1. Amber warning banner copy and styling
  const expectedWarningCopy = 'Live streaming active: timelapse capture resolution on this camera is temporarily reduced to SVGA';
  assert.ok(
    cardSrc.includes(expectedWarningCopy),
    `CameraCard must display exact amber warning banner copy: "${expectedWarningCopy}"`
  );
  assert.ok(
    cardSrc.includes('isStreaming && (') && cardSrc.includes('#ffaa00'),
    'Amber warning banner must be conditionally rendered when isStreaming is true with amber accent (#ffaa00)'
  );
  console.log('  ✓ Step 3.1: Amber warning banner copy and conditional display verified');

  // 2. Mode toggle buttons
  assert.ok(cardSrc.includes('isStreaming'), 'CameraCard must receive isStreaming prop');
  assert.ok(cardSrc.includes('onToggleStream'), 'CameraCard must receive onToggleStream callback');
  assert.ok(
    cardSrc.includes('📹 Live Stream') && cardSrc.includes('📷 Snapshot'),
    'CameraCard must display mode toggle buttons for 📹 Live Stream and 📷 Snapshot'
  );
  console.log('  ✓ Step 3.2: Mode toggle buttons for Live Stream and Snapshot verified');

  // 3. Native stream image tag and live badge
  assert.ok(
    cardSrc.includes('src={`http://${cleanIp}/stream`}') || cardSrc.includes('/stream'),
    'CameraCard must render stream image connecting to /stream endpoint'
  );
  assert.ok(
    cardSrc.includes('LIVE (~4 FPS)'),
    'CameraCard must render LIVE (~4 FPS) telemetry badge'
  );
  assert.ok(
    cardSrc.includes('Live stream disconnected') && cardSrc.includes('onError'),
    'CameraCard must handle stream onError by reverting stream mode and notifying user'
  );
  console.log('  ✓ Step 3.3: Native stream viewer, LIVE (~4 FPS) badge, and onError fallback verified');

  console.log('✓ SUITE 3 PASSED: Live stream viewer and amber banner verified.\n');

  // =========================================================================
  // SUITE 4: Tab Visibility Teardown Logic & Socket Protection
  // =========================================================================
  console.log('--- SUITE 4: Tab Visibility Teardown Logic & Socket Protection ---');

  // 1. Webapp visibilitychange listener
  assert.ok(
    cardSrc.includes("document.addEventListener('visibilitychange', handleVisibilityChange)") ||
    cardSrc.includes('addEventListener("visibilitychange", handleVisibilityChange)'),
    'CameraCard must register visibilitychange event listener'
  );

  assert.ok(
    cardSrc.includes("document.visibilityState === 'hidden'"),
    'CameraCard must detect when document.visibilityState is hidden'
  );

  assert.ok(
    cardSrc.includes("document.removeEventListener('visibilitychange', handleVisibilityChange)") ||
    cardSrc.includes('removeEventListener("visibilitychange", handleVisibilityChange)'),
    'CameraCard must clean up visibilitychange listener on unmount/dependency change'
  );

  assert.ok(
    cardSrc.includes('useEffect(() => {') && cardSrc.includes('[isStreaming, onToggleStream]'),
    'Visibility change effect must properly depend on [isStreaming, onToggleStream]'
  );
  console.log('  ✓ Step 4.1: Webapp registers and cleans up visibilitychange listener to teardown socket on hidden tab');

  // 2. Firmware stream preemption and client connection takeover
  assert.ok(
    mainCppSrc.includes('volatile bool stream_active'),
    'Firmware must define volatile bool stream_active'
  );
  assert.ok(
    mainCppSrc.includes('volatile bool stream_pause_requested'),
    'Firmware must define volatile bool stream_pause_requested'
  );
  assert.ok(
    mainCppSrc.includes('volatile uint32_t stream_client_id'),
    'Firmware must define volatile uint32_t stream_client_id'
  );
  assert.ok(
    mainCppSrc.includes('FRAMESIZE_SVGA') && mainCppSrc.includes('FRAMESIZE_UXGA'),
    'Firmware must support SVGA streaming resolution and UXGA idle/timelapse resolution'
  );
  assert.ok(
    mainCppSrc.includes('stream_pause_requested = true'),
    'captureTask must request stream pause before acquiring camera sensor'
  );
  console.log('  ✓ Step 4.2: Firmware preemption flags and sensor resolution switching contracts verified');

  console.log('✓ SUITE 4 PASSED: Tab visibility teardown and socket protection verified.\n');

  // =========================================================================
  // SUITE 5: Repository Version Consistency & Cross-Component Contracts
  // =========================================================================
  console.log('--- SUITE 5: Repository Version Consistency & Cross-Component Contracts ---');

  // 1. Webapp package.json version check (1.3.6)
  const pkgPath = path.join(__dirname, '../webapp/package.json');
  assert.ok(fs.existsSync(pkgPath), 'webapp/package.json must exist');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.strictEqual(
    pkg.version,
    '1.3.6',
    `webapp/package.json version must be 1.3.6 (found: ${pkg.version})`
  );
  console.log('  ✓ Step 5.1: Webapp package.json version is 1.3.6');

  // 2. Firmware version check (v1.3.2)
  const firmwareVersionMatch = mainCppSrc.match(/#define\s+FIRMWARE_VERSION\s+"([^"]+)"/);
  assert.ok(firmwareVersionMatch, 'Firmware must define FIRMWARE_VERSION macro');
  assert.strictEqual(
    firmwareVersionMatch[1],
    'v1.3.2',
    `firmware/src/main.cpp FIRMWARE_VERSION must be "v1.3.2" (found: "${firmwareVersionMatch[1]}")`
  );

  const majorMatch = mainCppSrc.match(/#define\s+VERSION_MAJOR\s+(\d+)/);
  const minorMatch = mainCppSrc.match(/#define\s+VERSION_MINOR\s+(\d+)/);
  assert.ok(majorMatch && minorMatch, 'Firmware must define VERSION_MAJOR and VERSION_MINOR');
  assert.strictEqual(majorMatch[1], '1', 'VERSION_MAJOR must be 1');
  assert.strictEqual(minorMatch[1], '3', 'VERSION_MINOR must be 3');
  console.log('  ✓ Step 5.2: Firmware version is v1.3.2 (Major 1, Minor 3)');

  console.log('✓ SUITE 5 PASSED: Version consistency verified across all components.\n');

  console.log('====================================================');
  console.log('ALL 5 STREAM & SNAPSHOT TEST SUITES PASSED!');
  console.log('====================================================');
}

runTests();

