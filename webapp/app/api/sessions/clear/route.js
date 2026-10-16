import { NextResponse } from 'next/server';
import { monitor } from '../../../../lib/monitor';

export async function DELETE() {
  try {
    await monitor.deleteAllSessions();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
