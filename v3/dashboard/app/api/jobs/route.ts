import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Proxies the Apps Script doGet. The token stays on the server. */
export async function GET() {
  const url = process.env.SHEET_API_URL;
  const token = process.env.SHEET_API_TOKEN;
  if (!url || !token) {
    return NextResponse.json({ error: 'SHEET_API_URL or SHEET_API_TOKEN is not set' }, { status: 500 });
  }
  try {
    // `cache: no-store` only governs this fetch; Google caches the /exec response itself
    // and will serve an identical GET back for minutes. A changing parameter is the only
    // way past it — without this the dashboard can show a Sheet as it was, not as it is.
    const res = await fetch(`${url}?token=${encodeURIComponent(token)}&_=${Date.now()}`, { cache: 'no-store' });
    const text = await res.text();
    // Apps Script answers with HTML on an auth problem, so fail loudly rather than
    // letting JSON.parse throw something unreadable.
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ error: 'Sheet API did not return JSON', body: text.slice(0, 300) }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
