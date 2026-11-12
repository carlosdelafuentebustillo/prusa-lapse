import fs from 'fs';
import path from 'path';

/**
 * Locate the compiled or bundled ESP32-CAM firmware binary.
 * Prefers a fresh PlatformIO build in development, falling back to public/firmware.bin in standalone/desktop builds.
 */
export function findLatestFirmware(cwd = process.cwd()) {
  const candidatePaths = [
    path.resolve(cwd, '../firmware/.pio/build/esp32cam/firmware.bin'),
    path.resolve(cwd, 'firmware/.pio/build/esp32cam/firmware.bin'),
    path.resolve(cwd, 'public/firmware.bin'),
    path.resolve(cwd, '../public/firmware.bin'),
    path.resolve(cwd, 'firmware.bin'),
    path.resolve(cwd, '../firmware.bin')
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const stats = fs.statSync(p);
        if (stats.size > 100000) {
          return { path: p, stats };
        }
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Read the embedded FIRMWARE_VERSION C-string directly from a compiled firmware.bin image.
 * Looks near the "firmware_version" JSON field in .rodata so framework/SDK version strings are not matched.
 */
export function extractVersionFromBinary(firmwarePath) {
  if (!firmwarePath) return null;
  try {
    const buf = fs.readFileSync(firmwarePath);
    const marker = Buffer.from('firmware_version', 'ascii');
    let idx = buf.indexOf(marker);
    while (idx !== -1) {
      const start = Math.max(0, idx - 512);
      const end = Math.min(buf.length, idx + 512);
      const slice = buf.subarray(start, end).toString('latin1');
      const match = slice.match(/\x00(v\d+\.\d+\.\d+(?:[-.\w]*)?)\x00/);
      if (match && match[1]) {
        return match[1];
      }
      idx = buf.indexOf(marker, idx + marker.length);
    }
  } catch (e) {}
  return null;
}

/**
 * Resolve the firmware version string from the binary itself, an accompanying firmware-version.txt sidecar,
 * or the repository's firmware/src/main.cpp source header.
 */
export function getFirmwareVersion(firmwarePath = null, cwd = process.cwd()) {
  const binVersion = extractVersionFromBinary(firmwarePath);
  if (binVersion) {
    return binVersion;
  }

  const sidecarPaths = [
    firmwarePath ? path.join(path.dirname(firmwarePath), 'firmware-version.txt') : null,
    path.resolve(cwd, 'public/firmware-version.txt'),
    path.resolve(cwd, '../public/firmware-version.txt')
  ].filter(Boolean);

  for (const vp of sidecarPaths) {
    try {
      if (fs.existsSync(vp)) {
        const ver = fs.readFileSync(vp, 'utf8').trim();
        if (ver) {
          return ver;
        }
      }
    } catch (e) {}
  }

  const sourcePaths = [
    path.resolve(cwd, '../firmware/src/main.cpp'),
    path.resolve(cwd, 'firmware/src/main.cpp')
  ];

  for (const sp of sourcePaths) {
    try {
      if (fs.existsSync(sp)) {
        const text = fs.readFileSync(sp, 'utf8');
        const match = text.match(/#define\s+FIRMWARE_VERSION\s+"([^"]+)"/);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch (e) {}
  }

  return null;
}
