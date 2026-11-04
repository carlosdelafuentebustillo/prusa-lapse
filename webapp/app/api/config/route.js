import fs from 'fs/promises';
import path from 'path';
import { monitor } from '../../../lib/monitor.js';

const getConfigFile = () => process.env.PRUSALAPSE_CONFIG_FILE || path.join(process.cwd(), 'prusa-lapse.config.json');

export async function GET() {
  try {
    const config = await monitor.getConfig();
    return Response.json({ config: config || {} });
  } catch (error) {
    return Response.json({ config: {} });
  }
}

export async function POST(request) {
  try {
    const incoming = await request.json();
    const configFile = getConfigFile();
    let existing = {};
    try {
      const raw = await fs.readFile(configFile, 'utf-8');
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
      },
      slicer: {
        ...(existing.slicer || {}),
        ...(incoming.slicer || {})
      }
    };
    await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    
    // Log configuration changes
    monitor.log(`Configuration saved (Prusa IP: ${config.prusaIp || 'None'}, ${config.cameraIps ? config.cameraIps.length : 0} cameras)`, 'success');
    
    return Response.json({ success: true, config });
  } catch (error) {
    return Response.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
