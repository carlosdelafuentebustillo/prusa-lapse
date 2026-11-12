const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const tempCapturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prusalapse-deflicker-test-'));
process.env.PRUSALAPSE_CAPTURES_DIR = tempCapturesDir;

const { monitor } = require('../lib/monitor.js');

async function runTests() {
  console.log('====================================================');
  console.log('Deflicker & Outlier Rejection Verification Test Suite');
  console.log('====================================================\n');

  const ffmpegPath = path.resolve(__dirname, '../node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
  const sessionId = 'session_20261107_120000';
  const cameraKey = 'camera_000000000001';
  const camDir = path.join(tempCapturesDir, sessionId, cameraKey);
  fs.mkdirSync(camDir, { recursive: true });

  try {
    // Generate 12 synthetic >15KB JPEG frames: 10 normal mid-gray frames (~135 YAVG) + 2 extreme outliers (frame 4 dark, frame 8 bright)
    for (let i = 0; i < 12; i++) {
      const framePath = path.join(camDir, `frame_${String(i).padStart(4, '0')}.jpg`);
      let color = '0x888888'; // ~136 YAVG
      if (i === 4) color = '0x202020'; // ~32 YAVG (severe underexposed outlier)
      if (i === 8) color = '0xF5F5F5'; // ~245 YAVG (severe overexposed flash outlier)

      // Add noise so JPEG size is >= 15KB
      const genCmd = `"${ffmpegPath}" -y -hide_banner -f lavfi -i "color=c=${color}:s=800x600:d=1,noise=alls=35:allf=t" -frames:v 1 -q:v 2 "${framePath}"`;
      execSync(genCmd, { stdio: 'ignore' });
    }

    // Test 1: Verify monitor.compileVideo compiles session with outlier rejection & deflickering enabled
    console.log('--- TEST 1: Video Compilation with Outlier Rejection & Temporal Deflicker ---');
    const outputPath = await monitor.compileVideo(sessionId, cameraKey, {
      fps: 30,
      quality: 23,
      rotation: 0,
      filterDark: true,
      deflicker: true,
    });

    assert.ok(fs.existsSync(outputPath), `Compiled MP4 must exist at ${outputPath}`);
    const stat = fs.statSync(outputPath);
    assert.ok(stat.size > 1000, `Compiled video must be non-empty (got ${stat.size} bytes)`);
    console.log(`  ✓ Step 1.1: Successfully compiled ${sessionId}/${cameraKey}.mp4 (${stat.size} bytes)`);

    // Test 2: Measure luminance jumps in compiled video (should have 10 clean frames, 0 severe jumps)
    console.log('\n--- TEST 2: Quantitative Luminance Variance Verification ---');
    const analyzeCmd = `"${ffmpegPath}" -hide_banner -i "${outputPath}" -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null - 2>&1`;
    const ffmpegOutput = execSync(analyzeCmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

    const matches = [...ffmpegOutput.matchAll(/lavfi\.signalstats\.YAVG=([\d\.]+)/g)].map(m => parseFloat(m[1]));
    assert.strictEqual(matches.length, 10, `Expected 10 clean frames after filtering 2 outliers, got ${matches.length}`);

    let severeJumps = 0;
    let maxDelta = 0;
    for (let i = 1; i < matches.length; i++) {
      const delta = Math.abs(matches[i] - matches[i - 1]);
      if (delta > maxDelta) maxDelta = delta;
      if (delta > 15) severeJumps++;
    }

    console.log(`  ✓ Step 2.1: Analyzed ${matches.length} frames (2 rogue outliers rejected).`);
    console.log(`  ✓ Step 2.2: Severe frame-to-frame jumps (|delta| > 15): ${severeJumps}`);
    console.log(`  ✓ Step 2.3: Maximum frame-to-frame delta: ${maxDelta.toFixed(2)}`);

    assert.strictEqual(severeJumps, 0, `Severe luminance jumps must be 0 (got ${severeJumps})`);
    assert.ok(maxDelta < 5.0, `Maximum delta must be under 5.0 (got ${maxDelta.toFixed(2)})`);

    // Test 3: Firmware & Webapp Version Consistency Check
    console.log('\n--- TEST 3: Version Bump & Sensor Stability Compliance ---');
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.3.9', 'webapp/package.json version must be 1.3.9');
    console.log(`  ✓ Step 3.1: webapp/package.json version is ${pkg.version}`);

    const mainCpp = fs.readFileSync(path.resolve(__dirname, '../../firmware/src/main.cpp'), 'utf8');
    const fwVerMatch = mainCpp.match(/#define\s+FIRMWARE_VERSION\s+"([^"]+)"/);
    assert.ok(fwVerMatch && fwVerMatch[1] === 'v1.3.3', 'firmware/src/main.cpp FIRMWARE_VERSION must be v1.3.3');
    console.log(`  ✓ Step 3.2: firmware/src/main.cpp FIRMWARE_VERSION is ${fwVerMatch[1]}`);

    assert.ok(mainCpp.includes('s->set_aec2(s, 0);'), 'DSP AEC2 must be disabled in firmware');
    assert.ok(mainCpp.includes('s->set_gainceiling(s, GAINCEILING_4X);'), 'Gain ceiling must be capped at 4X in firmware');
    assert.ok(mainCpp.includes('pdMS_TO_TICKS(160)'), 'DMA flush delay must be 160ms');
    console.log('  ✓ Step 3.3: Firmware sensor stability configurations verified (AEC2=0, GAINCEILING_4X, 160ms flush).');

    console.log('\n====================================================');
    console.log('ALL DEFLICKER & COMPILER TESTS PASSED!');
    console.log('====================================================\n');
  } finally {
    fs.rmSync(tempCapturesDir, { recursive: true, force: true });
  }
}

runTests().catch(err => {
  console.error('\n❌ Test Failure:', err);
  process.exit(1);
});
