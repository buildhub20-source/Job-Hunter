'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Card, Table, Banner } from '@/components/ui';

const COLUMNS = ['received_at','classification','company','subject','from_address','match_method','match_confidence'];

export default function Page() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [dbDown, setDbDown] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ dbDown: boolean } & Record<string, unknown>>('/api/inbox')
      .then((d) => { setRows((d['messages'] as Record<string, unknown>[]) ?? []); setDbDown(Boolean(d.dbDown)); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Updates</h1>
      <Banner kind="info">Daily mail scan. Rows with no company could not be matched to an application and were left unattached.</Banner>
      {err && <Banner kind="error">API unreachable: {err}</Banner>}
      {dbDown && <Banner kind="warn">Postgres is not reachable yet.</Banner>}
      <Card><Table columns={COLUMNS} rows={rows} /></Card>
    </div>
  );
}
