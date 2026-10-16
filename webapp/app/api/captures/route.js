import fs from 'fs';
import path from 'path';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const session = searchParams.get('session');
  const file = searchParams.get('file');

  if (!session || !file) {
    return new Response('Missing session or file parameter', { status: 400 });
  }

  // Prevent directory traversal attacks
  if (
    session.includes('..') || 
    file.includes('..') || 
    session.includes('/') || 
    session.includes('\\') || 
    file.includes('/') || 
    file.includes('\\')
  ) {
    return new Response('Invalid path', { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'public', 'captures', session, file);

  if (!fs.existsSync(filePath)) {
    return new Response('File not found', { status: 404 });
  }

  const stat = fs.statSync(filePath);
  
  let contentType = 'application/octet-stream';
  if (file.endsWith('.mp4')) {
    contentType = 'video/mp4';
  } else if (file.endsWith('.jpg') || file.endsWith('.jpeg')) {
    contentType = 'image/jpeg';
  }

  // Support range requests for video scrubbing/seeking (needed for Chrome/Firefox/Safari players)
  const range = request.headers.get('range');
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    
    if (start >= stat.size || end >= stat.size) {
      return new Response('Requested range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${stat.size}` }
      });
    }

    const chunksize = (end - start) + 1;
    const fileStreamRange = fs.createReadStream(filePath, { start, end });

    return new Response(fileStreamRange, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  }

  const fileStream = fs.createReadStream(filePath);
  return new Response(fileStream, {
    headers: {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    }
  });
}
