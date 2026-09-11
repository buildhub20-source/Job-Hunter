'use client';
import { useCallback, useEffect, useState } from 'react';

type Job = Record<string, string>;
type Tick = { at: string; identified: number; enriched: number; gated: number } | null;
type Payload = {
  generatedAt?: string;
  lastTick?: Tick;
  triggers?: { fn: string; type: string }[];
  totals?: Record<string, number>;
  gateBreakdown?: { reason: string; count: number }[];
  jobs?: Job[];
  error?: string;
};

/** Status colours are reserved for status and always ship with the label, never colour alone. */
const STATUS: Record<string, string> = {
  Applied: 'var(--good)',
  Blocked: 'var(--serious)',
  Failed: 'var(--critical)',
  Skipped: 'var(--ink-3)',
  'Not Applied': 'var(--ink-3)',
};

function Pill({ value }: { value: string }) {
  return (
    <span className="pill">
      <span className="dot" style={{ background: STATUS[value] ?? 'var(--ink-3)' }} />
      {value || '—'}
    </span>
  );
}

function ago(iso?: string) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!isFinite(mins)) return 'never';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export default function Page() {
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('All');
  const [gate, setGate] = useState('All');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/jobs', { cache: 'no-store' });
      const j: Payload = await r.json();
      if (j.error) { setErr(j.error); return; }
      setD(j); setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);

  async function runTick() {
    setBusy(true);
    try {
      const r = await fetch('/api/tick', { method: 'POST' });
      const j = await r.json();
      if (j.error) setErr(j.error);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const t = d?.totals ?? {};
  const jobs = d?.jobs ?? [];
  const gates = d?.gateBreakdown ?? [];
  const rejected = gates.reduce((a, g) => a + g.count, 0);

  const shown = jobs.filter((j) => {
    if (status !== 'All' && j['Status'] !== status) return false;
    if (gate === 'Passed' && j['Gate Result'] !== 'Pass') return false;
    if (gate === 'Rejected' && (j['Gate Result'] === 'Pass' || !j['Gate Result'])) return false;
    return true;
  });

  return (
    <>
      <h1>JobOps</h1>
      <p className="sub">
        Spark finds jobs and writes them to the Sheet. This script gives them identity,
        enriches them from the ATS API, and runs the gates.
      </p>

      {err && <div className="card err"><strong>Error:</strong> {err}</div>}

      <div className="tiles">
        <div className="tile"><div className="k">Total jobs</div><div className="v">{t.all ?? '—'}</div></div>
        <div className="tile"><div className="k">Passed gates</div><div className="v">{t.passed ?? '—'}</div></div>
        <div className="tile"><div className="k">Not applied</div><div className="v">{t.notApplied ?? '—'}</div></div>
        <div className="tile"><div className="k">Applied</div><div className="v" style={{ color: 'var(--good)' }}>{t.applied ?? '—'}</div></div>
        <div className="tile"><div className="k">Blocked</div><div className="v" style={{ color: (t.blocked ?? 0) > 0 ? 'var(--serious)' : undefined }}>{t.blocked ?? '—'}</div></div>
        <div className="tile"><div className="k">Failed</div><div className="v" style={{ color: (t.failed ?? 0) > 0 ? 'var(--critical)' : undefined }}>{t.failed ?? '—'}</div></div>
      </div>

      <div className="card">
        <h2>Pipeline</h2>
        <div className="row">
          <button className="primary" onClick={() => void runTick()} disabled={busy}>
            {busy ? 'Running…' : 'Run pipeline'}
          </button>
          <button onClick={() => void load()} disabled={busy}>Refresh</button>
          <span className="note" style={{ marginTop: 0 }}>
            Last run {ago(d?.lastTick?.at)}
            {d?.lastTick ? ` · ${d.lastTick.identified} identified, ${d.lastTick.enriched} enriched, ${d.lastTick.gated} gated` : ''}
          </span>
        </div>
        <p className="note">
          Runs normalize → enrich → gate. It cannot start a Spark discovery run (Spark has no API —
          use Gemini, or wait for the 4-hour schedule) or the applier (Playwright runs locally).
          {d?.triggers?.length ? ` Triggers installed: ${d.triggers.map((x) => x.fn).join(', ')}.` : ''}
        </p>
      </div>

      {rejected > 0 && (
        <div className="card">
          <h2>Trimmed off by gates — {rejected} of {t.all ?? 0}</h2>
          {gates.map((g) => (
            <div className="bar-row" key={g.reason}>
              <div className="bar-head">
                <span>{g.reason}</span>
                <span className="n">{g.count} · {Math.round((g.count / rejected) * 100)}%</span>
              </div>
              <div className="track"><div className="fill" style={{ width: `${(g.count / rejected) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Jobs — showing {shown.length} of {jobs.length}</h2>
        <div className="row" style={{ marginBottom: 14 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {['All', 'Not Applied', 'Applied', 'Blocked', 'Failed', 'Skipped'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={gate} onChange={(e) => setGate(e.target.value)}>
            {['All', 'Passed', 'Rejected'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Company</th><th>Role</th><th>Location</th><th>Salary</th>
                <th>ATS</th><th>Match</th><th>Gate</th><th>Status</th><th>Link</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j['Job ID'] || j['Apply Link']}>
                  <td className="title">{j['Company Name']}</td>
                  <td>{j['Role']}</td>
                  <td>{j['Location']}</td>
                  <td>{j['Salary']}</td>
                  <td>{j['ATS']}</td>
                  <td>{String(j['Job Match'] || '').slice(0, 60)}</td>
                  <td style={{ color: j['Gate Result'] && j['Gate Result'] !== 'Pass' ? 'var(--serious)' : undefined }}>
                    {j['Gate Result'] || '—'}
                  </td>
                  <td><Pill value={j['Status']} /></td>
                  <td>{j['Apply Link'] ? <a href={j['Apply Link']} target="_blank" rel="noreferrer">open</a> : '—'}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={9} style={{ color: 'var(--ink-3)' }}>Nothing matches those filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
