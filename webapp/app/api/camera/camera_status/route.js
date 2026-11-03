import { NextResponse } from 'next/server';
import { monitor, extractCameraMac } from '../../../../lib/monitor';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ip = searchParams.get('ip');

  if (!ip) {
    return NextResponse.json({ error: 'Missing camera IP' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds timeout
    
    const res = await fetch(`http://${ip}/camera_status`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const mac = extractCameraMac(data);
      if (mac && !data.mac) data.mac = mac;
      monitor.recordCameraIdentity(ip, data).catch(() => {});
      return NextResponse.json(data);
    } else {
      return NextResponse.json({ error: `Camera returned status ${res.status}` }, { status: res.status });
    }
  } catch (e) {
    return NextResponse.json({ error: `Camera unreachable: ${e.message}` }, { status: 504 });
  }
}
