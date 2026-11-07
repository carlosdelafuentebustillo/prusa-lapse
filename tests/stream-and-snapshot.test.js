const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('Testing Single Active Stream Coordinator...\n');

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

  // Coordinator state reducer logic
  const streamCoordinatorReducer = (prev, cameraIp) => (prev === cameraIp ? null : cameraIp);

  // Test 1: Activating stream on Camera A sets active camera to A.
  let activeCamera = null;
  const cameraA = '192.168.1.100';
  const cameraB = '192.168.1.101';
  const cameraC = '192.168.1.102';

  activeCamera = streamCoordinatorReducer(activeCamera, cameraA);
  assert.strictEqual(activeCamera, cameraA, 'Activating Camera A should set active camera to A');
  assert.strictEqual(activeCamera === cameraA, true, 'Camera A should be streaming');
  assert.strictEqual(activeCamera === cameraB, false, 'Camera B should not be streaming');
  assert.strictEqual(activeCamera === cameraC, false, 'Camera C should not be streaming');
  console.log('✓ Test 1 Passed: Activating stream on Camera A sets active camera to A and disables others');

  // Test 2: Activating stream on Camera B automatically replaces A so only B is streaming.
  activeCamera = streamCoordinatorReducer(activeCamera, cameraB);
  assert.strictEqual(activeCamera, cameraB, 'Activating Camera B should replace Camera A');
  assert.strictEqual(activeCamera === cameraA, false, 'Camera A should no longer be streaming');
  assert.strictEqual(activeCamera === cameraB, true, 'Camera B should now be streaming');
  assert.strictEqual(activeCamera === cameraC, false, 'Camera C should remain not streaming');
  console.log('✓ Test 2 Passed: Activating stream on Camera B automatically replaces A so only B is streaming');

  // Test 3: Toggling Camera B off sets active camera to null.
  activeCamera = streamCoordinatorReducer(activeCamera, cameraB);
  assert.strictEqual(activeCamera, null, 'Toggling active Camera B again should set active camera to null');
  assert.strictEqual(activeCamera === cameraA, false, 'No camera should be streaming (A)');
  assert.strictEqual(activeCamera === cameraB, false, 'No camera should be streaming (B)');
  assert.strictEqual(activeCamera === cameraC, false, 'No camera should be streaming (C)');
  console.log('✓ Test 3 Passed: Toggling Camera B off sets active camera to null');

  console.log('\nTesting Webapp Camera Card UI & Version...\n');

  const pkgPath = path.join(__dirname, '../webapp/package.json');
  assert.ok(fs.existsSync(pkgPath), 'webapp/package.json must exist');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.strictEqual(pkg.version, '1.3.6', 'webapp version must be bumped to 1.3.6');
  console.log('✓ Test 4 Passed: Package version is 1.3.6');

  const cardPath = path.join(__dirname, '../webapp/app/components/CameraCard.js');
  assert.ok(fs.existsSync(cardPath), 'webapp/app/components/CameraCard.js must exist');
  const cardSrc = fs.readFileSync(cardPath, 'utf8');

  // Verify SnapshotImage is inert
  assert.ok(!cardSrc.includes('10000'), 'SnapshotImage must not contain 10000ms polling interval');
  assert.ok(!cardSrc.includes('handleRefresh'), 'SnapshotImage must not have handleRefresh handler');
  assert.ok(!cardSrc.includes('isRefreshing'), 'SnapshotImage must not track isRefreshing state');
  assert.ok(!cardSrc.includes('fresh=1'), 'SnapshotImage must not request fresh=1 snapshot');
  assert.ok(!cardSrc.includes('Click to capture a fresh snapshot'), 'SnapshotImage must not have click-to-refresh tooltip');
  console.log('✓ Test 5 Passed: SnapshotImage is completely inert (no polling, no click-to-refresh)');

  // Verify stream toggle and mode controls in CameraCard
  assert.ok(cardSrc.includes('isStreaming'), 'CameraCard must handle isStreaming prop');
  assert.ok(cardSrc.includes('onToggleStream'), 'CameraCard must handle onToggleStream prop');
  assert.ok(cardSrc.includes('Live Stream') && cardSrc.includes('Snapshot'), 'CameraCard must include mode toggle buttons');
  console.log('✓ Test 6 Passed: Mode toggle button controls present');

  // Verify amber warning banner copy
  assert.ok(
    cardSrc.includes('Live streaming active: timelapse capture resolution on this camera is temporarily reduced to SVGA'),
    'CameraCard must display amber warning copy when isStreaming is active'
  );
  console.log('✓ Test 7 Passed: Amber warning banner copy present');

  // Verify native stream img tag and live badge
  assert.ok(
    cardSrc.includes('/stream') && cardSrc.includes('LIVE (~4 FPS)'),
    'CameraCard must render /stream img element and LIVE (~4 FPS) badge'
  );
  console.log('✓ Test 8 Passed: Live stream img tag and LIVE (~4 FPS) badge present');

  // Verify visibilitychange listener for socket cleanup
  assert.ok(
    cardSrc.includes('visibilitychange'),
    'CameraCard must register visibilitychange listener to teardown stream on hidden tab'
  );
  console.log('✓ Test 9 Passed: Tab visibilitychange listener present for socket cleanup');

  console.log('\nALL STREAM & CAMERA CARD TESTS PASSED!');
}

runTests();
