const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('OrcaSlicer plugin installation directory resolution', async () => {
  const isWin = process.platform === 'win32';
  const baseDir = isWin
    ? path.join(process.env.APPDATA || '', 'OrcaSlicer', 'plugins')
    : path.join(process.env.HOME || '', '.config', 'OrcaSlicer', 'plugins');

  assert.ok(baseDir.includes('OrcaSlicer'));
  assert.ok(baseDir.includes('plugins'));
});

test('getOrcaSlicerPaths correctly resolves Windows and Unix paths', async () => {
  const { getOrcaSlicerPaths } = require('../app/api/slicer/utils.js');

  // Test Windows platform resolution
  const winPaths = getOrcaSlicerPaths({ APPDATA: 'C:\\MockAppData' }, 'win32');
  assert.equal(winPaths.orcaConfigDir, 'C:\\MockAppData\\OrcaSlicer');
  assert.equal(winPaths.targetDir, 'C:\\MockAppData\\OrcaSlicer\\plugins');
  assert.equal(winPaths.pluginDir, 'C:\\MockAppData\\OrcaSlicer\\plugins\\prusalapse');
  assert.equal(winPaths.pluginFile, 'C:\\MockAppData\\OrcaSlicer\\plugins\\prusalapse\\plugin.py');

  // Test Unix platform resolution
  const unixPaths = getOrcaSlicerPaths({ HOME: '/home/mockuser' }, 'linux');
  assert.equal(unixPaths.orcaConfigDir, path.join('/home/mockuser', '.config', 'OrcaSlicer'));
  assert.equal(unixPaths.targetDir, path.join('/home/mockuser', '.config', 'OrcaSlicer', 'plugins'));
  assert.equal(unixPaths.pluginDir, path.join('/home/mockuser', '.config', 'OrcaSlicer', 'plugins', 'prusalapse'));
});

test('getPluginSourceDir locates orcaslicer-plugin/prusalapse', async () => {
  const { getPluginSourceDir } = require('../app/api/slicer/utils.js');
  const sourceDir = getPluginSourceDir();
  assert.ok(sourceDir, 'Source directory should be found');
  assert.ok(fs.existsSync(sourceDir));
  assert.ok(fs.existsSync(path.join(sourceDir, 'plugin.py')));
  assert.ok(fs.existsSync(path.join(sourceDir, 'injector.py')));
});

test('GET /api/slicer/status returns expected status structure', async () => {
  const { GET } = require('../app/api/slicer/status/route.js');
  const res = await GET();
  const data = await res.json();

  assert.equal(typeof data.installed, 'boolean');
  assert.equal(typeof data.orcaDirectoryFound, 'boolean');
  assert.equal(typeof data.targetDir, 'string');
  assert.equal(typeof data.pluginDir, 'string');
  assert.ok(data.targetDir.includes('OrcaSlicer'));
  assert.ok(data.targetDir.includes('plugins'));
  assert.ok(data.pluginDir.endsWith('prusalapse'));
});

test('GET /api/slicer/status detects installed state correctly', async () => {
  const { GET } = require('../app/api/slicer/status/route.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-status-test-'));
  const origEnv = process.env.ORCASLICER_PLUGINS_DIR;
  try {
    process.env.ORCASLICER_PLUGINS_DIR = tempDir;

    // Before installation
    const res1 = await GET();
    const data1 = await res1.json();
    assert.equal(data1.installed, false);

    // Create plugin.py to simulate installation
    const pluginDir = path.join(tempDir, 'prusalapse');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.py'), '# mock plugin');

    // After installation
    const res2 = await GET();
    const data2 = await res2.json();
    assert.equal(data2.installed, true);
  } finally {
    if (origEnv !== undefined) {
      process.env.ORCASLICER_PLUGINS_DIR = origEnv;
    } else {
      delete process.env.ORCASLICER_PLUGINS_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/slicer/install installs plugin to target directory', async () => {
  const { POST } = require('../app/api/slicer/install/route.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-install-test-'));
  try {
    const mockReq = {
      json: async () => ({ targetDir: tempDir })
    };

    const res = await POST(mockReq);
    const data = await res.json();

    assert.equal(data.success, true);
    assert.equal(data.message, 'Installed successfully');
    assert.equal(data.pluginDir, path.join(tempDir, 'prusalapse'));

    // Verify files were actually copied
    assert.ok(fs.existsSync(path.join(tempDir, 'prusalapse', 'plugin.py')));
    assert.ok(fs.existsSync(path.join(tempDir, 'prusalapse', 'injector.py')));
    assert.ok(fs.existsSync(path.join(tempDir, 'prusalapse', 'config.json')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/slicer/install handles invalid target gracefully', async () => {
  const { POST } = require('../app/api/slicer/install/route.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-install-test2-'));
  const origEnv = process.env.ORCASLICER_PLUGINS_DIR;
  try {
    process.env.ORCASLICER_PLUGINS_DIR = tempDir;
    // Call without body - should use default targetDir from environment
    const res = await POST();
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(fs.existsSync(path.join(tempDir, 'prusalapse', 'plugin.py')));
  } finally {
    if (origEnv !== undefined) {
      process.env.ORCASLICER_PLUGINS_DIR = origEnv;
    } else {
      delete process.env.ORCASLICER_PLUGINS_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('monitor.getConfig() returns default slicer configuration', async () => {
  const { monitor } = require('../lib/monitor.js');
  const config = await monitor.getConfig();

  assert.ok(config);
  assert.ok(config.slicer);
  assert.equal(config.slicer.autoInjectOrcaSlicer, true);
  assert.equal(config.slicer.parkX, 240.0);
  assert.equal(config.slicer.parkY, 210.0);
  assert.equal(config.slicer.zHopHeight, 0.4);
  assert.equal(config.slicer.settleTime, 300);
  assert.equal(config.slicer.captureTime, 1200);
});

test('POST /api/slicer/install returns 400 when OrcaSlicer directory is not found', async () => {
  const { POST } = require('../app/api/slicer/install/route.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-existent-orca-'));
  const origAppData = process.env.APPDATA;
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const origPluginsDir = process.env.ORCASLICER_PLUGINS_DIR;

  try {
    delete process.env.ORCASLICER_PLUGINS_DIR;
    process.env.APPDATA = tempDir;
    process.env.USERPROFILE = tempDir;
    process.env.HOME = tempDir;

    // Call POST without customTargetDir or ORCASLICER_PLUGINS_DIR
    const res = await POST();
    const data = await res.json();

    assert.equal(res.status, 400);
    assert.equal(data.success, false);
    assert.ok(data.error.includes('OrcaSlicer configuration directory not found'));
  } finally {
    if (origAppData !== undefined) process.env.APPDATA = origAppData; else delete process.env.APPDATA;
    if (origHome !== undefined) process.env.HOME = origHome; else delete process.env.HOME;
    if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile; else delete process.env.USERPROFILE;
    if (origPluginsDir !== undefined) process.env.ORCASLICER_PLUGINS_DIR = origPluginsDir; else delete process.env.ORCASLICER_PLUGINS_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('monitor.getConfig() preserves existing config and merges slicer defaults', async () => {
  const { monitor } = require('../lib/monitor.js');
  const tempConfigFile = path.join(os.tmpdir(), `test-config-${Date.now()}.json`);
  const origEnv = process.env.PRUSALAPSE_CONFIG_FILE;

  try {
    fs.writeFileSync(tempConfigFile, JSON.stringify({
      prusaIp: '192.168.1.100',
      slicer: {
        parkX: 180.0
      }
    }));
    process.env.PRUSALAPSE_CONFIG_FILE = tempConfigFile;

    const config = await monitor.getConfig();
    assert.equal(config.prusaIp, '192.168.1.100');
    assert.equal(config.slicer.parkX, 180.0); // overridden
    assert.equal(config.slicer.parkY, 210.0); // default preserved
    assert.equal(config.slicer.autoInjectOrcaSlicer, true);
    assert.equal(config.slicer.settleTime, 300);
  } finally {
    if (origEnv !== undefined) {
      process.env.PRUSALAPSE_CONFIG_FILE = origEnv;
    } else {
      delete process.env.PRUSALAPSE_CONFIG_FILE;
    }
    if (fs.existsSync(tempConfigFile)) {
      fs.unlinkSync(tempConfigFile);
    }
  }
});
