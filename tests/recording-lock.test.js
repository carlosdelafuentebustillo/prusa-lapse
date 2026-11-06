const { monitor } = require('../webapp/lib/monitor');
const assert = require('assert');

async function runTests() {
  console.log('Testing Timelapse Recording Lock...');

  // Test 1: When monitor.isRunning is true
  monitor.isRunning = true;
  let rec1 = await monitor.isTimelapseRecording();
  assert.strictEqual(rec1.isRecording, true, 'Should detect recording when isRunning is true');
  console.log('✓ Test 1 Passed: Detected active recording when isRunning = true');

  // Verify fetchOfflineSession rejects
  await assert.rejects(
    async () => {
      await monitor.fetchOfflineSession();
    },
    (err) => {
      assert(err.message.includes('timelapse is actively recording'), `Unexpected error message: ${err.message}`);
      return true;
    },
    'Should reject fetchOfflineSession when isRunning is true'
  );
  console.log('✓ Test 1b Passed: fetchOfflineSession rejected when isRunning = true');

  // Verify wipeOfflineSD rejects
  const wipeResult1 = await monitor.wipeOfflineSD();
  assert.strictEqual(wipeResult1.success, false, 'wipeOfflineSD should fail when recording');
  assert(wipeResult1.error.includes('timelapse is actively recording'), 'wipe error should mention active recording');
  console.log('✓ Test 1c Passed: wipeOfflineSD rejected when isRunning = true');

  monitor.isRunning = false;

  // Test 2: When fakePrintActive is true
  monitor.fakePrintActive = true;
  let rec2 = await monitor.isTimelapseRecording();
  assert.strictEqual(rec2.isRecording, true, 'Should detect recording when fakePrintActive is true');
  console.log('✓ Test 2 Passed: Detected active recording when fakePrintActive = true');

  await assert.rejects(
    async () => {
      await monitor.fetchOfflineSession();
    },
    (err) => {
      assert(err.message.includes('timelapse is actively recording'), `Unexpected error message: ${err.message}`);
      return true;
    }
  );
  console.log('✓ Test 2b Passed: fetchOfflineSession rejected when fakePrintActive = true');

  monitor.fakePrintActive = false;

  // Test 3: When a camera reports PRINTING state
  await monitor.recordCameraIdentity('192.168.1.99', {
    camera_name: 'Cam 1',
    printer_state: 'PRINTING',
    job_name: 'test_bracket.bgcode'
  });
  let rec3 = await monitor.isTimelapseRecording();
  assert.strictEqual(rec3.isRecording, true, 'Should detect recording when camera reports PRINTING');
  assert(rec3.reason.includes('test_bracket.bgcode'), 'Should report active print job name');
  console.log('✓ Test 3 Passed: Detected active recording when camera is PRINTING');

  await assert.rejects(
    async () => {
      await monitor.fetchOfflineSession();
    },
    (err) => {
      assert(err.message.includes('timelapse is actively recording'), `Unexpected error message: ${err.message}`);
      return true;
    }
  );
  console.log('✓ Test 3b Passed: fetchOfflineSession rejected when camera is PRINTING');

  // Test 4: getStatus() includes isRecording
  const status = monitor.getStatus();
  assert.strictEqual(status.isRecording, true, 'getStatus() should include isRecording = true');
  assert.strictEqual(status.recordingJobName, 'test_bracket.bgcode', 'getStatus() should include recordingJobName');
  console.log('✓ Test 4 Passed: getStatus() reflects active timelapse recording');

  // Test 5: When camera finishes print (printer_state = FINISHED)
  await monitor.recordCameraIdentity('192.168.1.99', {
    camera_name: 'Cam 1',
    printer_state: 'FINISHED',
    job_name: 'test_bracket.bgcode'
  });
  // Isolate from real network cameras that might be printing right now
  const origGetConfig = monitor.getConfig.bind(monitor);
  monitor.getConfig = async () => ({ cameraIps: [] });
  delete monitor.knownCameraPrinterStates['192.168.1.38'];
  delete monitor.knownCameraPrinterStates['192.168.1.53'];

  let rec5 = await monitor.isTimelapseRecording();
  assert.strictEqual(rec5.isRecording, false, 'Should be false when camera is FINISHED');
  console.log('✓ Test 5 Passed: Recording lock clears when print is FINISHED');

  const status5 = monitor.getStatus();
  assert.strictEqual(status5.isRecording, false, 'getStatus() should report isRecording = false');
  console.log('✓ Test 5b Passed: getStatus() reflects idle state');

  monitor.getConfig = origGetConfig;

  console.log('\nALL RECORDING LOCK TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
