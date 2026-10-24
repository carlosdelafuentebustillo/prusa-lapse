import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ip = searchParams.get('ip');

  if (!ip) {
    return NextResponse.json({ error: 'Missing camera IP' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const [resStatus, resCamStatus] = await Promise.allSettled([
      fetch(`http://${ip}/status`, { signal: controller.signal }),
      fetch(`http://${ip}/camera_status`, { signal: controller.signal })
    ]);
    clearTimeout(timeoutId);

    let merged = {};
    let anyOk = false;

    if (resStatus.status === 'fulfilled' && resStatus.value.ok) {
      merged = { ...merged, ...(await resStatus.value.json()) };
      anyOk = true;
    }
    if (resCamStatus.status === 'fulfilled' && resCamStatus.value.ok) {
      merged = { ...merged, ...(await resCamStatus.value.json()) };
      anyOk = true;
    }

    if (anyOk) {
      return NextResponse.json(merged);
    } else {
      return NextResponse.json({ error: 'Camera returned error' }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: `Camera unreachable: ${e.message}` }, { status: 504 });
  }
}
