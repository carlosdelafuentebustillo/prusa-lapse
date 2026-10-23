import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function findLatestFirmware() {
  const candidatePaths = [
    path.resolve(process.cwd(), '../firmware/.pio/build/esp32cam/firmware.bin'),
    path.resolve(process.cwd(), 'firmware/.pio/build/esp32cam/firmware.bin'),
    path.resolve(process.cwd(), 'public/firmware.bin'),
    path.resolve(process.cwd(), '../public/firmware.bin'),
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
  return 'v1.2.0';
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

    // Node.js fetch with FormData uses Transfer-Encoding: chunked, which crashes ESPAsyncWebServer.
    // We must manually assemble the multipart payload into a single Buffer to calculate the Content-Length.
    const boundary = '----WebKitFormBoundaryOTAUpdate' + Date.now().toString(16);
    const crlf = '\r\n';
    
    const header = Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="update"; filename="${filename}"${crlf}` +
      `Content-Type: application/octet-stream${crlf}${crlf}`
    );
    const footer = Buffer.from(`${crlf}--${boundary}--${crlf}`);
    
    const bodyBuffer = Buffer.concat([header, fileBuffer, footer]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for OTA flash

    const response = await fetch(`http://${ip}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length.toString()
      },
      body: bodyBuffer,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const text = await response.text();
    
    if (response.ok) {
      return NextResponse.json({ success: true, message: text });
    } else {
      return NextResponse.json({ error: text || `Camera update returned HTTP ${response.status}` }, { status: response.status });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
