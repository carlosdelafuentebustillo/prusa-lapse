import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { monitor } from '../../../lib/monitor';

const CONFIG_FILE = path.join(process.cwd(), 'prusa-lapse.config.json');

export async function GET() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return NextResponse.json({ config: JSON.parse(data) });
  } catch (error) {
    return NextResponse.json({ config: {} });
  }
}

export async function POST(request) {
  try {
    const incoming = await request.json();
    let existing = {};
    try {
      const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
      existing = JSON.parse(raw) || {};
    } catch {}

    const config = {
      ...existing,
      ...incoming,
      cameraMacs: {
        ...(existing.cameraMacs || {}),
        ...(incoming.cameraMacs || {})
      },
      cameraNames: {
        ...(existing.cameraNames || {}),
        ...(incoming.cameraNames || {})
      }
    };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    
    // Log configuration changes
    monitor.log(`Configuration saved (Prusa IP: ${config.prusaIp || 'None'}, ${config.cameraIps ? config.cameraIps.length : 0} cameras)`, 'success');
    
    return NextResponse.json({ success: true, config });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
