import { NextResponse } from 'next/server';
import { monitor } from '../../../../lib/monitor';

export async function POST() {
  try {
    const result = await monitor.wipeOfflineSD();
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
