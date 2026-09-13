'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Card, Stat, Banner, Table } from '@/components/ui';

/* ── types ────────────────────────────────────────────────────────── */

type Adapter = {
  id: string;
  display_name: string;
  version: string;
  enabled: boolean;
  shadow_mode: boolean;
  status: string;
  last_check_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_summary: string | null;
  success_rate_24h: string | null;
  success_rate_7d: string | null;
};

type HealthEvent = {
  adapter_id: string;
  status: string;
  ok: boolean;
  summary: string | null;
  created_at: string;
};

type Board = {
  adapter_id: string;
  company_id: string;
  company_name: string;
  tenant_slug: string;
  job_count: string;
  last_discovery_at: string | null;
};

type HealthData = {
  dbDown: boolean;
  adapters: Adapter[];
  history: HealthEvent[];
  affectedJobs: Record<string, number>;
  boardBreakdown: Board[];
};

/* ── helpers ──────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'Healthy'  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
    : status === 'Broken' ? 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'
    : status === 'Degraded' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function RateBar({ label, rate }: { label: string; rate: string | null }) {
  const pct = rate !== null ? Math.round(Number(rate) * 100) : null;
  const barColor =
    pct === null ? 'bg-slate-200 dark:bg-slate-700'
    : pct >= 90  ? 'bg-emerald-500'
    : pct >= 50  ? 'bg-amber-500'
    : 'bg-rose-500';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
          {pct !== null ? `${pct}%` : '—'}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded ${barColor}`}
          style={{ width: `${pct !== null ? Math.max(pct, pct > 0 ? 3 : 0) : 0}%` }}
        />
      </div>
    </div>
  );
}

function fmtTime(v: string | null): string {
  if (!v) return '—';
  return new Date(v).toLocaleString();
}

/* ── page ─────────────────────────────────────────────────────────── */

export default function AdapterHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      setData(await apiGet<HealthData>('/api/adapters/health'));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, []);

  const adapters = data?.adapters ?? [];
  const healthy = adapters.filter((a) => a.status === 'Healthy').length;
  const degraded = adapters.filter((a) => a.status === 'Degraded' || a.status === 'Broken').length;
  const totalJobs = Object.values(data?.affectedJobs ?? {}).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Adapter health</h1>
        <p className="mt-1 text-sm text-slate-500">
          Status of each ATS adapter, per-board breakdowns, and recent health events.
          Rates are computed from the last 24 hours and 7 days of discovery runs.
        </p>
      </div>

      {err && <Banner kind="error">API unreachable: {err}. Is <code>npm run dev:api</code> running?</Banner>}
      {data?.dbDown && <Banner kind="warn">Postgres is not reachable. Start it with <code>npm run db:up</code>.</Banner>}

      {/* ── summary stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Adapters" value={adapters.length} />
        <Stat label="Healthy" value={healthy} />
        <Stat label="Degraded / Broken" value={degraded} tone={degraded > 0 ? 'alert' : 'normal'} />
        <Stat label="Total jobs discovered" value={totalJobs.toLocaleString()} />
      </div>

      {/* ── per-adapter cards ─────────────────────────────────── */}
      {adapters.map((adapter) => {
        const boards = (data?.boardBreakdown ?? []).filter((b) => b.adapter_id === adapter.id);
        const jobCount = data?.affectedJobs?.[adapter.id] ?? 0;

        return (
          <Card key={adapter.id} title={adapter.display_name} right={<StatusBadge status={adapter.status} />}>
            <div className="space-y-4">
              {/* top meta */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">Adapter ID</span>
                  <div className="font-mono text-slate-700 dark:text-slate-300">{adapter.id}</div>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">Version</span>
                  <div className="text-slate-700 dark:text-slate-300">{adapter.version}</div>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">Jobs discovered</span>
                  <div className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {jobCount.toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">Mode</span>
                  <div className="text-slate-700 dark:text-slate-300">
                    {adapter.shadow_mode ? 'Shadow' : adapter.enabled ? 'Active' : 'Disabled'}
                  </div>
                </div>
              </div>

              {/* timestamps */}
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">Last check</span>
                  <div className="text-slate-700 dark:text-slate-300">{fmtTime(adapter.last_check_at)}</div>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">Last success</span>
                  <div className="text-emerald-700 dark:text-emerald-400">{fmtTime(adapter.last_success_at)}</div>
                </div>
                <div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">Last failure</span>
                  <div className="text-rose-700 dark:text-rose-400">{fmtTime(adapter.last_failure_at)}</div>
                </div>
              </div>

              {/* success rate bars */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <RateBar label="24h success rate" rate={adapter.success_rate_24h} />
                <RateBar label="7d success rate" rate={adapter.success_rate_7d} />
              </div>

              {/* error */}
              {adapter.last_error_summary && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
                  <span className="font-medium">Last error:</span> {adapter.last_error_summary}
                </div>
              )}

              {/* per-board breakdown */}
              {boards.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Boards ({boards.length})
                  </h3>
                  <Table
                    columns={['company', 'tenant', 'jobs', 'last discovery']}
                    rows={boards.map((b) => ({
                      company: b.company_name,
                      tenant: b.tenant_slug,
                      jobs: b.job_count,
                      'last discovery': fmtTime(b.last_discovery_at),
                    }))}
                  />
                </div>
              )}
            </div>
          </Card>
        );
      })}

      {/* ── health event timeline ─────────────────────────────── */}
      <Card title="Recent health events">
        {(data?.history ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">
            No health events recorded yet. Run <code>POST /api/discovery/run</code> to generate them.
          </p>
        ) : (
          <Table
            columns={['adapter', 'status', 'ok', 'summary', 'time']}
            rows={(data?.history ?? []).map((e) => ({
              adapter: e.adapter_id,
              status: e.status,
              ok: e.ok,
              summary: e.summary ?? '—',
              time: fmtTime(e.created_at),
            }))}
          />
        )}
      </Card>
    </div>
  );
}
