import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import http from 'http';
import os from 'os';
import { execFile } from 'child_process';

function findLatestFirmware() {
  const candidatePaths = [
    path.resolve(process.cwd(), '../firmware/.pio/build/esp32cam/firmware.bin'),
    path.resolve(process.cwd(), 'firmware/.pio/build/esp32cam/firmware.bin'),
    path.resolve(process.cwd(), 'public/firmware.bin'),
    path.resolve(process.cwd(), '../public/firmware.bin'),
    path.resolve(process.cwd(), 'firmware.bin'),
    path.resolve(process.cwd(), '../firmware.bin'),
    'C:/Users/cafub/Documents/Antigravity/dual-dalmatian/firmware/.pio/build/esp32cam/firmware.bin'
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const stats = fs.statSync(p);
        if (stats.size > 100000) { // Valid binary > 100KB
          return { path: p, stats };
        }
      }
    } catch (e) {}
  }
  return null;
}

function getFirmwareVersion() {
  const sourcePaths = [
    path.resolve(process.cwd(), '../firmware/src/main.cpp'),
    path.resolve(process.cwd(), 'firmware/src/main.cpp'),
    'C:/Users/cafub/Documents/Antigravity/dual-dalmatian/firmware/src/main.cpp'
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
  return 'v1.2.1';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function GET() {
  try {
    const latest = findLatestFirmware();
    const version = getFirmwareVersion();

    if (!latest) {
      return NextResponse.json({
        available: false,
        message: 'No compiled firmware.bin found on server.'
      });
    }

    return NextResponse.json({
      available: true,
      filename: 'firmware.bin',
      version,
      sizeBytes: latest.stats.size,
      sizeFormatted: formatBytes(latest.stats.size),
      lastModified: latest.stats.mtime.toISOString(),
      path: latest.path
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const ip = request.nextUrl.searchParams.get('ip');
  
  if (!ip) {
    return NextResponse.json({ error: 'IP parameter is required' }, { status: 400 });
  }

  try {
    let fileBuffer = null;
    let filename = 'firmware.bin';

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('update');
      if (file && typeof file.arrayBuffer === 'function') {
        fileBuffer = Buffer.from(await file.arrayBuffer());
        filename = file.name || 'firmware.bin';
      }
    }

    // If no custom file was provided in form, load the latest compiled firmware automatically
    if (!fileBuffer || fileBuffer.length === 0) {
      const latest = findLatestFirmware();
      if (!latest) {
        return NextResponse.json({ 
          error: 'No uploaded file provided and no compiled firmware.bin found on disk.' 
        }, { status: 400 });
      }
      fileBuffer = fs.readFileSync(latest.path);
      filename = path.basename(latest.path);
    }

    // Attempt native curl upload first: curl handles 100-continue and strict TCP flow control natively,
    // avoiding the window buffer overflows and ECONNRESET crashes on ESP32-CAM.
    const tryNativeCurl = async () => {
      let tmpPath = null;
      try {
        tmpPath = path.join(os.tmpdir(), `esp32_ota_${Date.now()}.bin`);
        fs.writeFileSync(tmpPath, fileBuffer);
        const curlName = process.platform === 'win32' ? 'curl.exe' : 'curl';
        const localCurl = path.join(process.cwd(), 'bin', curlName);
        const curlCmd = fs.existsSync(localCurl) ? localCurl : curlName;
        return await new Promise((resolve) => {
          execFile(curlCmd, ['-s', '-S', '-F', `update=@${tmpPath}`, `http://${ip}/update`], { timeout: 90000 }, (err, stdout) => {
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
            if (err) return resolve(null);
            resolve(stdout.trim());
          });
        });
      } catch (e) {
        try { if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e2) {}
        return null;
      }
    };

    const curlResult = await tryNativeCurl();
    if (curlResult !== null && (curlResult === 'OK' || curlResult.includes('OK'))) {
      return NextResponse.json({ success: true, message: 'OK' });
    }

    // Node.js fetch with FormData uses Transfer-Encoding: chunked, which crashes ESPAsyncWebServer.
    // We assemble the multipart payload with exact Content-Length and stream it in paced 4KB chunks
    // respecting TCP backpressure ('drain') to avoid overwhelming the ESP32's 2.8KB window and power rail.
    const boundary = '----WebKitFormBoundaryOTAUpdate' + Date.now().toString(16);
    const crlf = '\r\n';
    
    const header = Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="update"; filename="${filename}"${crlf}` +
      `Content-Type: application/octet-stream${crlf}${crlf}`
    );
    const footer = Buffer.from(`${crlf}--${boundary}--${crlf}`);
    const totalLength = header.length + fileBuffer.length + footer.length;

    const updateResult = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: ip,
        port: 80,
        path: '/update',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': totalLength.toString(),
          'Connection': 'close'
        },
        timeout: 90000
      }, (res) => {
        let resBody = '';
        res.on('data', chunk => resBody += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode, text: resBody.trim() });
          } else {
            resolve({ ok: false, status: res.statusCode, text: resBody.trim() });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('OTA flash upload timed out after 90 seconds')); });

      // Write header
      req.write(header);

      // Paced writing of binary payload in 4KB chunks with 20ms pacing to avoid overwhelming ESP32 flash write buffers
      const chunkSize = 4096;
      let offset = 0;
      function sendNextChunk() {
        if (offset >= fileBuffer.length) {
          req.end(footer);
          return;
        }

        const end = Math.min(offset + chunkSize, fileBuffer.length);
        const chunk = fileBuffer.subarray(offset, end);
        offset = end;

        const canContinue = req.write(chunk);
        if (!canContinue) {
          req.once('drain', () => setTimeout(sendNextChunk, 20));
        } else {
          setTimeout(sendNextChunk, 20);
        }
      }

      sendNextChunk();
    });

    if (updateResult.ok && updateResult.text !== 'FAIL') {
      return NextResponse.json({ success: true, message: updateResult.text || 'OK' });
    } else {
      return NextResponse.json({ error: updateResult.text || `Camera update returned HTTP ${updateResult.status}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
