import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = { title: 'JobOps', description: 'Job-search operating system' };

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/funnel', label: 'Funnel' },
  { href: '/applications', label: 'Applications' },
  { href: '/updates', label: 'Updates' },
  { href: '/approvals', label: 'Approvals log' },
  { href: '/runs', label: 'Runs' },
  { href: '/adapters', label: 'Adapter health' },
  { href: '/profile', label: 'Profile' },
  { href: '/policies', label: 'Policies' },
  { href: '/audit', label: 'Audit log' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <aside className="w-52 shrink-0 border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-6">
              <div className="text-lg font-semibold">JobOps</div>
              <div className="text-xs text-slate-500">v2 · control plane</div>
            </div>
            <nav className="space-y-1">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="block rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <p className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500 dark:border-slate-800">
              Questions are answered in Google&nbsp;Chat, not here. This dashboard controls runs and shows state.
            </p>
          </aside>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
