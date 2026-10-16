import { NextResponse } from 'next/server';
import os from 'os';
import net from 'net';
import { monitor } from '../../../../lib/monitor';

function getLocalSubnets() {
  const subnets = [];
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // Look for active, non-internal IPv4 interfaces
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.');
        if (parts.length === 4) {
          const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
          if (!subnets.includes(subnet)) {
            subnets.push(subnet);
          }
        }
      }
    }
  }
  
  return subnets.length > 0 ? subnets : ['192.168.1'];
}

// Stage 1: Ultra-fast TCP port knock
function checkPort(port, host, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;

    socket.on('connect', () => {
      status = true;
      socket.destroy();
    });

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      socket.destroy();
    });

    socket.on('error', () => {
      socket.destroy();
    });

    socket.on('close', () => {
      resolve(status);
    });

    socket.connect(port, host);
  });
}

// Stage 2: Full HTTP verification
async function verifyDevice(ip) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000); // Generous 3s timeout
  
  try {
    const res = await fetch(`http://${ip}/`, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (res.ok) {
      const text = await res.text();
      if (text.includes('PrusaLapse Camera')) return 'camera';
    }
  } catch (e) {
    clearTimeout(timeoutId);
  }

  // Check if it's a PrusaLink printer
  const controller2 = new AbortController();
  const timeoutId2 = setTimeout(() => controller2.abort(), 3000);
  try {
    const res = await fetch(`http://${ip}/api/version`, { signal: controller2.signal });
    clearTimeout(timeoutId2);
    
    if (res.ok) {
      const text = await res.text();
      const serverHeader = res.headers.get('server') || '';
      if (text.includes('api') || serverHeader.includes('Prusa')) {
        return 'printer';
      }
    } else if (res.status === 401) {
      const authHeader = res.headers.get('www-authenticate') || '';
      if (authHeader.includes('Printer API')) {
        return 'printer';
      }
    }
  } catch (e) {
    clearTimeout(timeoutId2);
  }

  return null;
}

export async function GET() {
  try {
    const subnets = getLocalSubnets();
    const foundCameras = [];
    const foundPrinters = [];
    
    monitor.log(`Starting auto-detection scan on subnets: ${subnets.join(', ')}`, 'info');
    
    for (const subnet of subnets) {
      const promises = [];
      for (let i = 1; i < 255; i++) {
        const ip = `${subnet}.${i}`;
        promises.push(
          // Stagger each request by 20ms to prevent overwhelming the router / OS sockets
          new Promise(resolve => setTimeout(resolve, i * 20)).then(async () => {
            // Stage 1: Fast TCP Ping (2500ms timeout)
            const isOpen = await checkPort(80, ip, 2500);
            if (isOpen) {
              // Stage 2: It's an HTTP server, verify if it's our camera or printer
              const type = await verifyDevice(ip);
              if (type === 'camera') {
                foundCameras.push(ip);
                monitor.log(`Auto-detected PrusaLapse camera at ${ip}`, 'success');
              } else if (type === 'printer') {
                foundPrinters.push(ip);
                monitor.log(`Auto-detected Prusa printer at ${ip}`, 'success');
              }
            }
          })
        );
      }
      
      // Wait for all 255 staggered checks to finish
      await Promise.all(promises);
    }
    
    monitor.log(`Auto-detection scan finished. Found ${foundCameras.length} camera(s) and ${foundPrinters.length} printer(s).`, 'success');
    
    return NextResponse.json({ cameras: foundCameras, printers: foundPrinters });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
