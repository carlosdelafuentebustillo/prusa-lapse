import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const session = searchParams.get('session');
  const camera = searchParams.get('camera');

  if (!session || !camera) {
    return new Response('Missing session or camera parameter', { status: 400 });
  }

  // Prevent directory traversal attacks
  if (
    session.includes('..') || 
    camera.includes('..') || 
    session.includes('/') || 
    session.includes('\\') || 
    camera.includes('/') || 
    camera.includes('\\')
  ) {
    return new Response('Invalid path', { status: 400 });
  }

  const cameraPath = path.join(process.cwd(), 'public', 'captures', session, camera);

  if (!fs.existsSync(cameraPath)) {
    return new Response('Camera directory not found', { status: 404 });
  }

  try {
    const zip = new AdmZip();
    
    // Add all files in the directory to the zip
    const files = fs.readdirSync(cameraPath);
    const jpgFiles = files.filter(f => f.startsWith('frame_') && f.endsWith('.jpg'));
    
    if (jpgFiles.length === 0) {
      return new Response('No frames found to zip', { status: 400 });
    }

    for (const file of jpgFiles) {
      const filePath = path.join(cameraPath, file);
      zip.addLocalFile(filePath);
    }

    const zipBuffer = zip.toBuffer();

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${session}_${camera}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error) {
    return new Response(`Failed to create zip: ${error.message}`, { status: 500 });
  }
}
