import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Runs the Apps Script pipeline: normalize -> enrich -> gate. */
export async function POST() {
  const url = process.env.SHEET_API_URL;
  const token = process.env.SHEET_API_TOKEN;
  if (!url || !token) {
    return NextResponse.json({ error: 'SHEET_API_URL or SHEET_API_TOKEN is not set' }, { status: 500 });
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, action: 'tick' }),
      redirect: 'follow',
      cache: 'no-store',
    });
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ error: 'Sheet API did not return JSON', body: text.slice(0, 300) }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
