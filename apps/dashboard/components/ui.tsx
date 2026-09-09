'use client';
import { type ReactNode } from 'react';

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      {title && (
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = 'normal' }: { label: string; value: ReactNode; tone?: 'normal' | 'warn' | 'alert' }) {
  const toneClass =
    tone === 'alert' ? 'text-rose-600 dark:text-rose-400'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
    : 'text-slate-900 dark:text-slate-100';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

export function Banner({ kind, children }: { kind: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const cls =
    kind === 'error' ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200'
    : kind === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'
    : 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200';
  return <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Table({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
            {columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-2 font-medium">{c.replace(/_/g, ' ')}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
              {columns.map((c) => (
                <td key={c} className="whitespace-nowrap px-2 py-2 text-slate-700 dark:text-slate-300">
                  {format(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function format(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
