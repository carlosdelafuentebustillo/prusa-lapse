import { NextResponse } from 'next/server';

export async function POST(request) {
  const ip = request.nextUrl.searchParams.get('ip');
  
  if (!ip) {
    return NextResponse.json({ error: 'IP parameter is required' }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('update');
    
    if (!file) {
      return NextResponse.json({ error: 'No update file provided' }, { status: 400 });
    }

    // Node.js fetch with FormData uses Transfer-Encoding: chunked, which crashes ESPAsyncWebServer.
    // We must manually assemble the multipart payload into a single Buffer to calculate the Content-Length.
    const boundary = '----WebKitFormBoundaryOTAUpdate' + Date.now().toString(16);
    const crlf = '\r\n';
    
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    
    const header = Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="update"; filename="${file.name || 'firmware.bin'}"${crlf}` +
      `Content-Type: application/octet-stream${crlf}${crlf}`
    );
    const footer = Buffer.from(`${crlf}--${boundary}--${crlf}`);
    
    const bodyBuffer = Buffer.concat([header, fileBuffer, footer]);

    const response = await fetch(`http://${ip}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length.toString()
      },
      body: bodyBuffer
    });

    const text = await response.text();
    
    if (response.ok) {
      return NextResponse.json({ success: true, message: text });
    } else {
      return NextResponse.json({ error: text }, { status: response.status });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
