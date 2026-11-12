const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findLatestFirmware,
  extractVersionFromBinary,
  getFirmwareVersion
} = require('../app/api/camera/update/utils.js');

test('extractVersionFromBinary reads embedded firmware version near firmware_version marker', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prusalapse-fw-'));
  try {
    const binPath = path.join(tmpDir, 'firmware.bin');
    const payload = Buffer.concat([
      Buffer.alloc(256, 0xff),
      Buffer.from('"firmware_version":"%s"}\x00v1.3.3\x00noise', 'latin1'),
      Buffer.alloc(2048, 0x00),
      Buffer.from('\x00v2.0.17\x00', 'latin1')
    ]);
    fs.writeFileSync(binPath, payload);

    assert.equal(extractVersionFromBinary(binPath), 'v1.3.3');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getFirmwareVersion resolves version in standalone desktop directory without firmware/src/main.cpp', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prusalapse-standalone-'));
  const standaloneDir = path.join(tmpRoot, 'app');
  const publicDir = path.join(standaloneDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });

  try {
    const binPath = path.join(publicDir, 'firmware.bin');
    const padding = Buffer.alloc(110000, 0xaa);
    const marker = Buffer.from('"firmware_version":"%s"}\x00v1.3.3\x00', 'latin1');
    fs.writeFileSync(binPath, Buffer.concat([marker, padding]));

    const latest = findLatestFirmware(standaloneDir);
    assert.ok(latest, 'findLatestFirmware should locate public/firmware.bin in standalone cwd');
    assert.equal(latest.path, binPath);
    assert.equal(getFirmwareVersion(latest.path, standaloneDir), 'v1.3.3');

    // Without embedded marker, falls back cleanly to sibling firmware-version.txt
    fs.writeFileSync(binPath, padding);
    fs.writeFileSync(path.join(publicDir, 'firmware-version.txt'), 'v1.3.3\n', 'utf8');
    assert.equal(getFirmwareVersion(latest.path, standaloneDir), 'v1.3.3');

    // Without marker, sidecar, or main.cpp, returns null instead of a stale hardcoded version
    fs.rmSync(path.join(publicDir, 'firmware-version.txt'));
    assert.equal(getFirmwareVersion(latest.path, standaloneDir), null);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('bundled webapp/public/firmware.bin embeds current FIRMWARE_VERSION when present', () => {
  const binPath = path.resolve(__dirname, '../public/firmware.bin');
  const mainCppPath = path.resolve(__dirname, '../../firmware/src/main.cpp');
  if (!fs.existsSync(binPath)) {
    return; // Ignored build artifact in fresh CI checkouts
  }
  const mainCpp = fs.readFileSync(mainCppPath, 'utf8');
  const expected = mainCpp.match(/#define\s+FIRMWARE_VERSION\s+"([^"]+)"/)?.[1];
  assert.ok(expected, 'FIRMWARE_VERSION must be defined in firmware/src/main.cpp');
  assert.equal(extractVersionFromBinary(binPath), expected);
});
