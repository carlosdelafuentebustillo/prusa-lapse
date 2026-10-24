import { NextResponse } from 'next/server';
import { monitor } from '../../../../lib/monitor';

export async function POST(request) {
  try {
    let targetSessionIds = null;
    let sessionTimestamp = null;
    let jobName = null;
    let jobId = null;
    try {
      const body = await request.json();
      targetSessionIds = body.targetSessionIds || null;
      sessionTimestamp = body.sessionTimestamp || null;
      jobName = body.jobName || null;
      jobId = body.jobId || null;
    } catch (e) {
      // Ignore JSON parse errors if body is empty
    }
    const result = await monitor.fetchOfflineSession(targetSessionIds, sessionTimestamp, jobName, jobId);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error, sessionId: result.sessionId }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
