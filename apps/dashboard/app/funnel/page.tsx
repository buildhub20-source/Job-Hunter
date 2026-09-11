'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Card, Stat, Banner, Table } from '@/components/ui';

type Totals = {
  discovered: string;
  evaluated: string;
  eligible: string;
  rejected: string;
  rejected_hard_gate: string;
  rejected_llm: string;
  not_yet_evaluated: string;
};
type Counted = { gate: string; count: string };
type Reason = { gate: string; reason: string; count: string };
type Tier = { tier: string; count: string };
type Funnel = {
  dbDown: boolean;
  error?: string;
  totals: Totals;
  byTier: Tier[];
  byGate: Counted[];
  byReason: Reason[];
};

/** Barrier display names and bar colours, keyed by the gate ids the API returns. */
const GATES: Record<string, { label: string; bar: string; note: string }> = {
  experience:    { label: 'Experience',    bar: 'bg-rose-500',   note: 'JD floor above the configured maximum' },
  location:      { label: 'Location',      bar: 'bg-amber-500',  note: 'role is outside the target country' },
  title:         { label: 'Title keyword', bar: 'bg-sky-500',    note: 'title contains a blocked seniority word' },
  llm_judgement: { label: 'LLM judgement', bar: 'bg-violet-500', note: 'passed the gates, rejected on reading the JD' },
  other:         { label: 'Other',         bar: 'bg-slate-400',  note: 'unclassified reason' },
};

const n = (v: string | undefined) => Number(v ?? 0);
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** A labelled proportional bar. Width is a percentage of `whole`. */
function Bar({ label, value, whole, bar, right }:
  { label: string; value: number; whole: number; bar: string; right?: string }) {
  const width = pct(value, whole);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-700 dark:text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-500">
          <strong className="text-slate-900 dark:text-slate-100">{value.toLocaleString()}</strong>
          {right && <span className="ml-2 text-xs">{right}</span>}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded ${bar}`} style={{ width: `${Math.max(width, value > 0 ? 1.5 : 0)}%` }} />
      </div>
    </div>
  );
}

export default function FunnelPage() {
  const [data, setData] = useState<Funnel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try { setData(await apiGet<Funnel>('/api/funnel')); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, []);

  const t = data?.totals;
  const discovered = n(t?.discovered);
  const evaluated = n(t?.evaluated);
  const eligible = n(t?.eligible);
  const rejected = n(t?.rejected);
  const pending = n(t?.not_yet_evaluated);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Funnel</h1>
        <p className="mt-1 text-sm text-slate-500">
          What survived, and which barrier removed the rest. Gates run before the model, so anything
          they reject is never read by an LLM.
        </p>
      </div>

      {err && <Banner kind="error">API unreachable: {err}. Is <code>npm run dev:api</code> running?</Banner>}
      {data?.dbDown && <Banner kind="warn">Postgres is not reachable. Start it with <code>npm run db:up</code>.</Banner>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Discovered" value={discovered.toLocaleString()} />
        <Stat label="Evaluated" value={evaluated.toLocaleString()} />
        <Stat label="Eligible" value={eligible.toLocaleString()} />
        <Stat label="Rejected" value={rejected.toLocaleString()} tone={rejected > eligible ? 'warn' : 'normal'} />
      </div>

      <Card title="Pipeline">
        <div className="space-y-4">
          <Bar label="Discovered" value={discovered} whole={discovered} bar="bg-slate-500" right="all postings stored" />
          <Bar label="Evaluated" value={evaluated} whole={discovered} bar="bg-sky-500"
               right={`${pct(evaluated, discovered).toFixed(0)}% of discovered`} />
          <Bar label="Eligible" value={eligible} whole={discovered} bar="bg-emerald-500"
               right={`${pct(eligible, discovered).toFixed(1)}% of discovered · ${pct(eligible, evaluated).toFixed(0)}% of evaluated`} />
        </div>
        {pending > 0 && (
          <p className="mt-4 text-sm text-slate-500">
            <strong className="text-slate-700 dark:text-slate-300">{pending.toLocaleString()}</strong> postings
            have never been evaluated. Run <code>POST /api/evaluate/run</code> to judge them.
          </p>
        )}
      </Card>

      <Card title="Trimmed off by barriers">
        {rejected === 0 ? (
          <p className="text-sm text-slate-500">Nothing rejected yet.</p>
        ) : (
          <>
            <div className="space-y-4">
              {(data?.byGate ?? []).map((g) => {
                const meta = GATES[g.gate] ?? GATES['other']!;
                const count = n(g.count);
                return (
                  <div key={g.gate}>
                    <Bar label={meta.label} value={count} whole={rejected} bar={meta.bar}
                         right={`${pct(count, rejected).toFixed(0)}% of rejections`} />
                    <p className="mt-1 text-xs text-slate-500">{meta.note}</p>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-800">
              Hard gates removed {n(t?.rejected_hard_gate).toLocaleString()} before any model call;
              the LLM rejected a further {n(t?.rejected_llm).toLocaleString()} after reading the description.
            </p>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Eligible by tier">
          <Table
            columns={['tier', 'count']}
            rows={(data?.byTier ?? []).map((r) => ({ tier: r.tier, count: r.count }))}
          />
        </Card>

        <Card title="Rejection reasons">
          <Table
            columns={['barrier', 'reason', 'count']}
            rows={(data?.byReason ?? []).map((r) => ({
              barrier: (GATES[r.gate] ?? GATES['other']!).label,
              reason: r.reason,
              count: r.count,
            }))}
          />
        </Card>
      </div>
    </div>
  );
}
