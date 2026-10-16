import { NextResponse } from 'next/server';
import { monitor } from '../../../lib/monitor';

export async function POST(request) {
  try {
    const { sessionId, cameraIndex, options } = await request.json();
    if (!sessionId || cameraIndex === undefined) {
      return NextResponse.json({ error: 'Missing sessionId or cameraIndex' }, { status: 400 });
    }

    await monitor.compileVideo(sessionId, cameraIndex, options);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
