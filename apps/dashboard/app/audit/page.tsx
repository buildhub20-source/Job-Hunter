'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Card, Table, Banner } from '@/components/ui';

const COLUMNS = ['created_at','actor','action','reason','policy_version','result'];

export default function Page() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [dbDown, setDbDown] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ dbDown: boolean } & Record<string, unknown>>('/api/audit')
      .then((d) => { setRows((d['events'] as Record<string, unknown>[]) ?? []); setDbDown(Boolean(d.dbDown)); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      
      {err && <Banner kind="error">API unreachable: {err}</Banner>}
      {dbDown && <Banner kind="warn">Postgres is not reachable yet.</Banner>}
      <Card><Table columns={COLUMNS} rows={rows} /></Card>
    </div>
  );
}
