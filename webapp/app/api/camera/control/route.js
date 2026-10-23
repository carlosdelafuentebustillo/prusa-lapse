import { NextResponse } from 'next/server';
import { monitor } from '../../../../lib/monitor';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ip = searchParams.get('ip');
  const variable = searchParams.get('var');
  const value = searchParams.get('val');

  if (!ip || !variable || (value === null && !searchParams.get('token') && !searchParams.get('name') && !searchParams.get('fingerprint'))) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 seconds timeout
    
    // Forward all query parameters except 'ip' to the camera
    const cameraParams = new URLSearchParams(searchParams);
    cameraParams.delete('ip');
    
    const res = await fetch(`http://${ip}/control?${cameraParams.toString()}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const text = await res.text();
      
      // Log control parameter changes
      if (variable === 'camera_name') {
        const nameVal = searchParams.get('name') || value;
        monitor.log(`Camera ${ip} renamed to "${nameVal}"`, 'success');
      } else if (variable === 'led') {
        const mode = value === '2' ? 'Auto' : (value === '1' ? 'On' : 'Off');
        monitor.log(`Camera ${ip} flash mode set to ${mode}`, 'info');
      } else if (variable === 'prusa_connect_token') {
        const hasToken = searchParams.get('token') && searchParams.get('token').length > 0;
        monitor.log(`Camera ${ip} Prusa Connect token ${hasToken ? 'saved' : 'cleared'}`, 'info');
      } else if (variable === 'fingerprint') {
        monitor.log(`Camera ${ip} Prusa Connect fingerprint updated`, 'info');
      } else if (variable === 'offline') {
        const mode = value === '1' ? 'Offline' : 'Online';
        monitor.log(`Camera ${ip} set to ${mode} mode`, 'info');
      } else {
        monitor.log(`Camera ${ip} setting adjusted: ${variable} = ${value}`, 'info');
      }
      
      return new Response(text, { status: 200 });
    } else {
      return new Response(`Failed to set control: status ${res.status}`, { status: res.status });
    }
  } catch (e) {
    return NextResponse.json({ error: `Camera unreachable: ${e.message}` }, { status: 504 });
  }
}
