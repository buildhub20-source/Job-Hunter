'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Card, Table, Banner } from '@/components/ui';

const COLUMNS = ['created_at','type','status','question','field_key','scope','approved_answer','answered_at'];

export default function Page() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [dbDown, setDbDown] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ dbDown: boolean } & Record<string, unknown>>('/api/approvals')
      .then((d) => { setRows((d['approvals'] as Record<string, unknown>[]) ?? []); setDbDown(Boolean(d.dbDown)); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Approvals log</h1>
      <Banner kind="info">Read-only. Questions are asked and answered in Google Chat; this is the record.</Banner>
      {err && <Banner kind="error">API unreachable: {err}</Banner>}
      {dbDown && <Banner kind="warn">Postgres is not reachable yet.</Banner>}
      <Card><Table columns={COLUMNS} rows={rows} /></Card>
    </div>
  );
}
