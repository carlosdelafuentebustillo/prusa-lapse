import { NextResponse } from 'next/server';
import { monitor } from '../../../lib/monitor';

export async function GET(req) {
  const url = new URL(req.url);
  const includeRemote = url.searchParams.get('remote') === 'true';
  const sessions = await monitor.getSessions(includeRemote);
  return NextResponse.json({ sessions });
}

export async function PATCH(request) {
  try {
    const { sessionId, name } = await request.json();
    const meta = await monitor.renameSession(sessionId, name);
    return NextResponse.json({ success: true, meta });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function DELETE(request) {
  try {
    const { sessionId } = await request.json();
    await monitor.deleteSession(sessionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}