const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prusalapse-fixes-test-'));
const tempCapturesDir = path.join(tempRoot, 'captures');
const tempConfigFile = path.join(tempRoot, 'prusa-lapse.config.json');
fs.mkdirSync(tempCapturesDir, { recursive: true });
fs.writeFileSync(
  tempConfigFile,
  JSON.stringify({
    prusaIp: '',
    prusaApiKey: '',
    cameraIps: ['127.0.0.1', '127.0.0.2'],
    cameraMacs: { '127.0.0.1': 'AABBCCDDEE01', '127.0.0.2': 'AABBCCDDEE02' },
    cameraNames: { AABBCCDDEE01: 'Corner', AABBCCDDEE02: 'X-Axis' }
  }),
  'utf8'
);

process.env.PRUSALAPSE_CAPTURES_DIR = tempCapturesDir;
process.env.PRUSALAPSE_CONFIG_FILE = tempConfigFile;

const { monitor } = require('../lib/monitor.js');

const ffmpegPath = (() => {
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    return path.resolve(__dirname, '../node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
  }
})();

function writeSyntheticFrames(dir, count, resolution = '800x600', startIndex = 0) {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const idx = startIndex + i;
    const framePath = path.join(dir, `frame_${String(idx).padStart(4, '0')}.jpg`);
    execSync(
      `"${ffmpegPath}" -y -hide_banner -f lavfi -i "color=c=0x888888:s=${resolution}:d=1,noise=alls=35:allf=t" -frames:v 1 -q:v 2 "${framePath}"`,
      { stdio: 'ignore' }
    );
  }
}

test('compileVideo handles 5-frame clip with deflicker=true without crashing', async () => {
  const sessionId = 'session_20261113_100000';
  const camKey = 'camera_AABBCCDDEE01';
  const camDir = path.join(tempCapturesDir, sessionId, camKey);
  writeSyntheticFrames(camDir, 5, '800x600');

  const outMp4 = await monitor.compileVideo(sessionId, camKey, {
    fps: 30,
    quality: 23,
    filterDark: false,
    deflicker: true
  });

  assert.ok(fs.existsSync(outMp4), 'Compiled MP4 should exist for 5-frame fallback');
  assert.ok(fs.statSync(outMp4).size > 1000, 'Compiled MP4 should be non-empty');
});

test('compileVideo normalizes mixed SVGA + UXGA frames cleanly', async () => {
  const sessionId = 'session_20261113_100500';
  const camKey = 'camera_AABBCCDDEE01';
  const camDir = path.join(tempCapturesDir, sessionId, camKey);
  writeSyntheticFrames(camDir, 4, '800x600', 0);
  writeSyntheticFrames(camDir, 4, '1600x1200', 4);

  const outMp4 = await monitor.compileVideo(sessionId, camKey, {
    fps: 30,
    quality: 23,
    filterDark: false,
    deflicker: false
  });

  assert.ok(fs.existsSync(outMp4), 'Compiled MP4 should exist for mixed-dimension session');
  assert.ok(fs.statSync(outMp4).size > 2000, 'Compiled MP4 from mixed dimensions should be valid');
});

test('monitor.stop() enforces per-camera <= 20 frame discard rule', async () => {
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  try {
    // Case A: All cameras <= 20 frames -> whole session directory removed
    const shortSess = 'session_20261113_101000';
    const shortDir = path.join(tempCapturesDir, shortSess);
    fs.mkdirSync(path.join(shortDir, 'camera_AABBCCDDEE01'), { recursive: true });
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(shortDir, 'camera_AABBCCDDEE01', `frame_${String(i).padStart(4, '0')}.jpg`), Buffer.alloc(16000, 0xaa));
    }
    monitor.isRunning = true;
    monitor.currentSession = shortSess;
    monitor.frameCount = 20;
    await monitor.stop();
    assert.equal(fs.existsSync(shortDir), false, 'Session with <= 20 frames on all cameras must be deleted on stop()');

    // Case B: Asymmetric dual-camera (21 frames on Corner vs 5 frames on X-Axis) -> keep 21-frame cam, drop 5-frame cam
    const asymSess = 'session_20261113_101500';
    const asymDir = path.join(tempCapturesDir, asymSess);
    fs.mkdirSync(path.join(asymDir, 'camera_AABBCCDDEE01'), { recursive: true });
    fs.mkdirSync(path.join(asymDir, 'camera_AABBCCDDEE02'), { recursive: true });
    for (let i = 0; i < 21; i++) {
      fs.writeFileSync(path.join(asymDir, 'camera_AABBCCDDEE01', `frame_${String(i).padStart(4, '0')}.jpg`), Buffer.alloc(16000, 0xaa));
    }
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(asymDir, 'camera_AABBCCDDEE02', `frame_${String(i).padStart(4, '0')}.jpg`), Buffer.alloc(16000, 0xaa));
    }
    monitor.isRunning = true;
    monitor.currentSession = asymSess;
    monitor.frameCount = 26;
    await monitor.stop();
    assert.equal(fs.existsSync(path.join(asymDir, 'camera_AABBCCDDEE01')), true, '21-frame camera folder must be preserved');
    assert.equal(fs.existsSync(path.join(asymDir, 'camera_AABBCCDDEE02')), false, '5-frame camera folder must be discarded');
  } finally {
    global.fetch = origFetch;
  }
});

test('getSessions and fetchOfflineSession discard short (<= 20 frame) remote cameras per-camera', async () => {
  const origFetch = global.fetch;
  monitor.remoteSessionsCache = [];

  global.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('127.0.0.1/download_sd?file=sessions.jsonl')) {
      return {
        ok: true,
        text: async () =>
          [
            JSON.stringify({ session: 's0001', frames: 8, timestamp: '20261113_110000', job_id: 501, job_name: 'TooShort' }),
            JSON.stringify({ session: 's0002', frames: 34, timestamp: '20261113_111000', job_id: 502, job_name: 'AsymPrint' })
          ].join('\n')
      };
    }
    if (urlStr.includes('127.0.0.2/download_sd?file=sessions.jsonl')) {
      return {
        ok: true,
        text: async () =>
          [
            JSON.stringify({ session: 's0001', frames: 3, timestamp: '20261113_110000', job_id: 501, job_name: 'TooShort' }),
            JSON.stringify({ session: 's0002', frames: 5, timestamp: '20261113_111000', job_id: 502, job_name: 'AsymPrint' })
          ].join('\n')
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const sessions = await monitor.getSessions(true);
    const shortRemote = sessions.find(s => s.jobId === 501);
    const asymRemote = sessions.find(s => s.jobId === 502);
    assert.equal(shortRemote, undefined, 'Session with <= 20 frames on all cameras must not appear');
    assert.ok(asymRemote, 'Session with 34 frames on Corner must appear');
    assert.equal(asymRemote.cameras.length, 1, 'Short 5-frame camera must be filtered out of asymmetric session');
    assert.equal(asymRemote.cameras[0].frameCount, 34);

    // Also verify fetchOfflineSession discards if invoked directly for a <= 20 frame remote session
    const discardRes = await monitor.fetchOfflineSession(
      { '127.0.0.1': 's0001', '127.0.0.2': 's0001' },
      '20261113_110000',
      'TooShort',
      501,
      'remote_20261113_110000_s0001',
      { '127.0.0.1': 8, '127.0.0.2': 3 }
    );
    assert.equal(discardRes.success, false);
    assert.equal(discardRes.discarded, true);
  } finally {
    global.fetch = origFetch;
  }
});

test('Cross-component contracts: mode locking, unified desktop path, and firmware reliability', () => {
  const mainCpp = fs.readFileSync(path.resolve(__dirname, '../../firmware/src/main.cpp'), 'utf8');
  const pageJs = fs.readFileSync(path.resolve(__dirname, '../app/page.js'), 'utf8');
  const cardJs = fs.readFileSync(path.resolve(__dirname, '../app/components/CameraCard.js'), 'utf8');
  const desktopMainJs = fs.readFileSync(path.resolve(__dirname, '../../desktop/main.js'), 'utf8');
  const desktopPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../desktop/package.json'), 'utf8'));

  assert.equal(desktopPkg.version, '1.3.10', 'desktop/package.json must stay synced at 1.3.10');
  assert.ok(desktopMainJs.includes("app.getPath('appData'), 'PrusaLapse'"), 'desktop/main.js must use canonical PrusaLapse appData directory');
  assert.ok(!desktopMainJs.includes("app.getPath('userData')"), 'desktop/main.js must not split data into prusalapse-desktop userData');

  assert.ok(mainCpp.includes('#define MIN_TIMELAPSE_FRAMES 21'), 'Firmware must enforce MIN_TIMELAPSE_FRAMES = 21');
  assert.ok(mainCpp.includes('print_mode_locked') && mainCpp.includes('print_locked_stream'), 'Firmware must track print-start mode lock');
  assert.ok(mainCpp.includes('cleanupTempTarFiles()'), 'Firmware must purge stale .tar.tmp archives on boot');
  assert.ok(mainCpp.includes('state_mutex'), 'Firmware must synchronize cross-core String state');
  assert.ok(mainCpp.includes('http.end(); // Always release PrusaLink /api/v1/status socket BEFORE opening jobHttp'), 'Firmware must close status HTTP socket before jobHttp');
  assert.ok(mainCpp.includes('ESP.getMaxAllocHeap() < 38000'), 'Firmware must guard Prusa Connect TLS against low internal heap');

  assert.ok(pageJs.includes('isStreamModeLocked'), 'UI page must track print-start stream/snapshot mode lock');
  assert.ok(cardJs.includes('disabled={isStreamModeLocked}'), 'CameraCard must disable mode toggle button while locked');
});

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
