'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Card, Table, Banner } from '@/components/ui';

type Policy = Record<string, unknown>;
const COLS = ['id', 'rule', 'value', 'scope', 'priority', 'effective_from', 'notes'];

export default function PoliciesPage() {
  const [hard, setHard] = useState<Policy[]>([]);
  const [rank, setRank] = useState<Policy[]>([]);
  const [version, setVersion] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ hardGates: Policy[]; rankingSignals: Policy[]; policyVersion: string }>('/api/policies')
      .then((d) => { setHard(d.hardGates); setRank(d.rankingSignals); setVersion(d.policyVersion); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Policies</h1>
        <p className="mt-1 text-sm text-slate-500">
          From <code>data/policies/*.md</code> · version <code>{version || '—'}</code>.
          Changing any file changes the version, which invalidates the evaluation cache.
        </p>
      </div>
      {err && <Banner kind="error">API unreachable: {err}</Banner>}
      <Banner kind="warn">
        Hard gates eliminate a job in code, before any model call. Ranking signals only move it between tiers. Never merge the two.
      </Banner>
      <Card title={`Hard gates (${hard.length})`}><Table columns={COLS} rows={hard} /></Card>
      <Card title={`Ranking signals (${rank.length})`}><Table columns={COLS} rows={rank} /></Card>
    </div>
  );
}
