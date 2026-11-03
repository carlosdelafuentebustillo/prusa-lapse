import { NextResponse } from 'next/server';
import { monitor } from '../../../lib/monitor';

export async function POST(request) {
  try {
    const { sessionId, camera, cameraIndex, options } = await request.json();
    const targetCamera = camera || (cameraIndex !== undefined ? cameraIndex : undefined);
    if (!sessionId || targetCamera === undefined) {
      return NextResponse.json({ error: 'Missing sessionId or camera' }, { status: 400 });
    }

    await monitor.compileVideo(sessionId, targetCamera, options);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
