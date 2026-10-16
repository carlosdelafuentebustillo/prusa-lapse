import { NextResponse } from 'next/server';
import { monitor } from '../../../lib/monitor';
import os from 'os';

function getWebappIpAndPort(request) {
  const host = request.headers.get('host') || '';
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return host;
  }
  
  // Fallback to local network interfaces
  const interfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
    if (localIp !== '127.0.0.1') break;
  }
  
  const port = host.split(':')[1] || '3000';
  return `${localIp}:${port}`;
}

export const dynamic = 'force-dynamic';

export async function GET(request) {
  return NextResponse.json(monitor.getStatus());
}

export async function POST(request) {
  const { action } = await request.json();
  
  if (action === 'start') {
    await monitor.start();
    return NextResponse.json({ success: true, status: 'started' });
  } else if (action === 'stop') {
    monitor.stop();
    return NextResponse.json({ success: true, status: 'stopped' });
  } else if (action === 'capture') {
    const result = await monitor.manualTrigger();
    if (result.success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
  } else if (action === 'test') {
    try {
      const webappUrl = getWebappIpAndPort(request);
      await monitor.runCameraTest(webappUrl);
      return NextResponse.json({ success: true });
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

