#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnswerStore } from './questions.js';
import type { FilledValue } from './adapters/common.js';

/**
 * One page showing, per job, exactly what the form held when the applier finished
 * filling it — read back from the page — beside a screenshot of the form. For checking
 * the data before anything is submitted. `npm run report` writes
 * screenshots/fill-report.html; it contains personal data and stays out of Git.
 */

interface FillRecord {
  jobId: string;
  company: string;
  role: string;
  applyLink: string;
  status: string;
  notes: string;
  values: FilledValue[];
  at: string;
  image: string | null;
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
const latest = new Map<string, FillRecord>();
for (const file of readdirSync(dir).filter((f) => /_fill_.*\.json$/.test(f))) {
  const record = JSON.parse(readFileSync(resolve(dir, file), 'utf-8')) as FillRecord;
  const seen = latest.get(record.jobId);
  if (!seen || record.at > seen.at) latest.set(record.jobId, record);
}

if (latest.size === 0) {
  console.error('No fill records yet — run `npm run apply` (a dry run is fine) first.');
  process.exit(1);
}

const answers = new AnswerStore();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function row(jobId: string, v: FilledValue): string {
  const empty = v.value.trim() === '';
  const fromDiscord = !empty && answers.lookup(jobId, v.label) === v.value;
  const written = !empty && answers.generatedAnswer(jobId, v.label) === v.value;
  const label = v.label.replace(/\*/g, '').trim();
  const cls = empty && v.required ? 'missing' : empty ? 'blank' : '';
  const value = empty ? (v.required ? 'EMPTY — required' : '—') : esc(v.value);
  const source = written
    ? '<span class="tag written">Written — review</span>'
    : fromDiscord ? '<span class="tag discord">Discord answer</span>' : '';
  return `<tr class="${cls}"><td>${esc(label)}${v.required ? ' <span class="req">*</span>' : ''}</td>` +
    `<td class="value">${value}</td><td>${source}</td></tr>`;
}

const jobs = [...latest.values()].sort((a, b) => a.company.localeCompare(b.company));
const cards = jobs.map((r) => {
  const missing = r.values.filter((v) => v.required && !v.value.trim()).length;
  const ready = r.status.startsWith('Dry run') && missing === 0;
  const image = r.image && existsSync(r.image)
    ? `<details><summary>Form screenshot</summary><img alt="Form for ${esc(r.company)}" src="data:image/png;base64,${readFileSync(r.image).toString('base64')}"></details>`
    : '';
  return `<section class="card">
  <header>
    <div><h2>${esc(r.company)}</h2><p class="role">${esc(r.role)} · <a href="${esc(r.applyLink)}">posting</a> · <code>${esc(r.jobId)}</code></p></div>
    <span class="badge ${ready ? 'ok' : 'warn'}">${ready ? 'Ready to submit' : esc(r.status)}</span>
  </header>
  ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ''}
  <p class="meta">Filled ${new Date(r.at).toLocaleString()} · ${r.values.length} fields · ${missing ? `<strong>${missing} required empty</strong>` : 'no required field empty'}</p>
  <div class="scroll"><table><thead><tr><th>Field</th><th>Value on the form</th><th>Source</th></tr></thead>
  <tbody>${r.values.map((v) => row(r.jobId, v)).join('')}</tbody></table></div>
  ${image}
</section>`;
}).join('\n');

const html = `<title>Applier Fill Check</title>
<style>
  :root { --bg:#f7f7f5; --card:#fff; --ink:#1c1c1a; --muted:#6b6b66; --line:#e4e4df; --bad:#b42318; --badbg:#fdecea; --ok:#1d7a46; --okbg:#e7f5ec; --warn:#8a5a00; --warnbg:#fdf3e1; --tag:#4b3fb8; --tagbg:#eeecfb; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141413; --card:#1e1e1c; --ink:#ecece8; --muted:#9a9a94; --line:#33332f; --bad:#ff8a80; --badbg:#3a1f1c; --ok:#7fd49e; --okbg:#18301f; --warn:#f0c060; --warnbg:#332a14; --tag:#b3a9ff; --tagbg:#2a2745; } }
  :root[data-theme="dark"] { --bg:#141413; --card:#1e1e1c; --ink:#ecece8; --muted:#9a9a94; --line:#33332f; --bad:#ff8a80; --badbg:#3a1f1c; --ok:#7fd49e; --okbg:#18301f; --warn:#f0c060; --warnbg:#332a14; --tag:#b3a9ff; --tagbg:#2a2745; }
  body { background:var(--bg); color:var(--ink); font:14px/1.5 system-ui, sans-serif; margin:0; padding:24px; }
  main { max-width:980px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; } .lead { color:var(--muted); margin:0 0 24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin-bottom:18px; }
  header { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
  h2 { font-size:17px; margin:0; } .role, .meta { color:var(--muted); margin:2px 0 0; } .meta { margin:10px 0; }
  a { color:inherit; } code { font-size:12px; }
  .badge { white-space:nowrap; font-size:12px; font-weight:600; padding:3px 10px; border-radius:999px; }
  .badge.ok { color:var(--ok); background:var(--okbg); } .badge.warn { color:var(--warn); background:var(--warnbg); }
  .notes { color:var(--warn); background:var(--warnbg); padding:8px 12px; border-radius:6px; margin:12px 0 0; }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:6px 8px; border-top:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:500; font-size:12px; border-top:0; }
  td.value { font-weight:500; white-space:pre-wrap; max-width:520px; }
  tr.missing td { color:var(--bad); background:var(--badbg); } tr.blank td.value { color:var(--muted); font-weight:400; }
  .req { color:var(--bad); } .tag { font-size:11px; padding:1px 7px; border-radius:999px; white-space:nowrap; }
  .tag.discord { color:var(--tag); background:var(--tagbg); } .tag.written { color:var(--warn); background:var(--warnbg); }
  details { margin-top:12px; } summary { cursor:pointer; color:var(--muted); } img { max-width:100%; border:1px solid var(--line); border-radius:6px; margin-top:8px; }
</style>
<main>
  <h1>Applier fill check</h1>
  <p class="lead">What each form held when filling finished, read back from the page. Nothing here has been submitted.</p>
  ${cards}
</main>`;

const out = resolve(dir, 'fill-report.html');
writeFileSync(out, html);
console.log(`Report: ${out}`);
for (const r of jobs) {
  const missing = r.values.filter((v) => v.required && !v.value.trim()).length;
  console.log(`  ${r.company.padEnd(12)} ${r.status}${missing ? ` — ${missing} required empty` : ''}`);
}
