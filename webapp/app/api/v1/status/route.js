import { NextResponse } from 'next/server';
import { monitor } from '../../../../lib/monitor';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (monitor.fakePrintActive) {
    return NextResponse.json({
      state: 'PRINTING',
      speed: 100,
      axis_z: 0.0,
      time_printing: 0,
      progress: 0
    });
  } else {
    return NextResponse.json({
      state: 'READY',
      speed: 100
    });
  }
}
