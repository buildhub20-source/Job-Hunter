'use client';
import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '@/lib/api';
import { Card, Stat, Banner } from '@/components/ui';

type Stats = Record<string, string | number | boolean | undefined> & { dbDown?: boolean; error?: string };
type Notification = { id: string; kind: string; title: string; body: string; dashboard_path?: string };
type Run = { id: string; mode: string; status: string; phase: string; started_at: string };

const MODES = ['discovery_only', 'dry_run', 'assisted', 'approval_gated', 'autonomous'] as const;

export default function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [notes, setNotes] = useState<Notification[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [mode, setMode] = useState<string>('assisted');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const [s, n, r] = await Promise.all([
        apiGet<Stats>('/api/stats'),
        apiGet<{ notifications: Notification[] }>('/api/notifications'),
        apiGet<{ runs: Run[] }>('/api/runs'),
      ]);
      setStats(s); setNotes(n.notifications ?? []); setRuns(r.runs ?? []); setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 10_000); return () => clearInterval(t); }, []);

  const active = runs.find((r) => r.status === 'running' || r.status === 'wind_down');

  async function startRun() {
    setMsg(null);
    try {
      await apiSend('/api/runs', 'POST', { mode, trigger: 'manual', maxDurationMinutes: 60 });
      setMsg(`run started in ${mode}`); void refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }
  async function stopRun() {
    if (!active) return;
    try { await apiSend(`/api/runs/${active.id}/stop`, 'POST'); setMsg('run stopped'); void refresh(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>

      {err && <Banner kind="error">API unreachable: {err}. Is <code>npm run dev:api</code> running?</Banner>}
      {stats?.dbDown && <Banner kind="warn">Postgres is not reachable. Start it with <code>npm run db:up</code> then <code>npm run db:migrate</code>.</Banner>}

      {notes.length > 0 && (
        <Card title={`Needs you (${notes.length})`}>
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950">
                <span className="font-medium">{n.title}</span>
                <span className="ml-2 text-slate-600 dark:text-slate-400">{n.body}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Discovered today" value={stats?.discovered_today ?? '—'} />
        <Stat label="New eligible" value={stats?.eligible ?? '—'} />
        <Stat label="A tier" value={stats?.a_tier ?? '—'} />
        <Stat label="Submitted today" value={stats?.submitted_today ?? '—'} />
        <Stat label="Pending questions" value={stats?.pending_approvals ?? '—'} tone="warn" />
        <Stat label="Human action" value={stats?.human_action ?? '—'} tone="alert" />
        <Stat label="Retries waiting" value={stats?.retries_waiting ?? '—'} tone="warn" />
        <Stat label="Adapters degraded" value={stats?.adapters_degraded ?? '—'} tone="warn" />
        <Stat label="Unmatched mail" value={stats?.unmatched_mail ?? '—'} />
        <Stat label="Tokens today" value={stats?.tokens_today ?? '—'} />
        <Stat label="Cost today" value={stats?.cost_today ? `$${Number(stats.cost_today).toFixed(3)}` : '—'} />
      </div>

      <Card title="Run control">
        {active ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
              {active.status}
            </span>
            <span>mode <strong>{active.mode}</strong> · phase {active.phase}</span>
            <button onClick={() => void stopRun()} className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900">
              Stop run
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <select value={mode} onChange={(e) => setMode(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800">
              {MODES.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
            <button onClick={() => void startRun()} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900">
              Start run
            </button>
            <span className="text-xs text-slate-500">60 minute cap · wind-down at 55</span>
          </div>
        )}
        {msg && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{msg}</p>}
      </Card>
    </div>
  );
}
