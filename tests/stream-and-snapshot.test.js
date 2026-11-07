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

  console.log('\nALL STREAM COORDINATOR TESTS PASSED!');
}

runTests();
