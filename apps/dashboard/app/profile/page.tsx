'use client';
import { useEffect, useState } from 'react';
import { apiGet, apiSend } from '@/lib/api';
import { Card, Banner } from '@/components/ui';

type Fact = {
  key: string; value: string; section: string; source: string;
  approved: boolean; approved_at: string | null; expires_at: string | null;
  sensitivity: 'low' | 'normal' | 'high'; notes: string; usable: boolean;
};
type Payload = { facts: Fact[]; stale: string[]; unusable: string[]; issues: { file: string; line: string; message: string }[] };

export default function ProfilePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try { setData(await apiGet<Payload>('/api/profile')); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void refresh(); }, []);

  async function save(f: Fact) {
    try {
      const res = await apiSend<{ commit: string | null }>('/api/profile/fact', 'PUT', {
        key: f.key, value: draft, section: f.section, source: 'dashboard',
        sensitivity: f.sensitivity, notes: f.notes, reason: 'edited in dashboard',
      });
      setMsg(`saved ${f.key}${res.commit ? ` (commit ${res.commit})` : ''}`);
      setEditing(null); void refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }

  if (err) return <Banner kind="error">API unreachable: {err}</Banner>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  const sections = [...new Set(data.facts.map((f) => f.section))];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="mt-1 text-sm text-slate-500">
          Backed by <code>data/personal.md</code>. Nothing here is stored in the database.
          Every save is committed to Git.
        </p>
      </div>

      {data.issues.length > 0 && (
        <Banner kind="error">
          <strong>personal.md has problems:</strong>
          <ul className="mt-1 list-disc pl-5">
            {data.issues.map((i, n) => <li key={n}>{i.file} [{i.line}] {i.message}</li>)}
          </ul>
        </Banner>
      )}
      {data.stale.length > 0 && (
        <Banner kind="warn">Expired, needs reconfirmation: {data.stale.join(', ')}</Banner>
      )}
      {msg && <Banner kind="info">{msg}</Banner>}

      {sections.map((section) => (
        <Card key={section} title={section}>
          <div className="space-y-1">
            {data.facts.filter((f) => f.section === section).map((f) => (
              <div key={f.key} className="flex items-center gap-3 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800/60">
                <div className="w-56 shrink-0">
                  <div className="font-mono text-xs">{f.key}</div>
                  {f.notes && <div className="text-xs text-slate-500">{f.notes}</div>}
                </div>

                <div className="flex-1">
                  {editing === f.key ? (
                    <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800" />
                  ) : (
                    <span className={f.usable ? 'text-sm' : 'text-sm italic text-slate-400'}>
                      {f.usable ? f.value : 'UNKNOWN — the agent will ask'}
                    </span>
                  )}
                </div>

                <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                  f.usable ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                           : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                  {f.usable ? 'usable' : 'not approved'}
                </span>

                {editing === f.key ? (
                  <>
                    <button onClick={() => void save(f)} className="rounded bg-slate-900 px-2 py-1 text-xs text-white dark:bg-slate-100 dark:text-slate-900">Save</button>
                    <button onClick={() => setEditing(null)} className="text-xs text-slate-500">Cancel</button>
                  </>
                ) : (
                  <button onClick={() => { setEditing(f.key); setDraft(f.usable ? f.value : ''); }}
                    className="text-xs text-sky-600 hover:underline dark:text-sky-400">Edit</button>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
