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
    const res = await fetch(`${url}?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
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
