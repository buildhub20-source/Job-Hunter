# What's Next

Steps 8–17. Order matters: each assumes the one before it works.

---

## Step 0 (do this first) — Prove steps 1–7

Not a build step. Four phases are written and unproven, and everything below compounds
that risk.

```
npm install
npm run db:up && npm run db:migrate     # or point DATABASE_URL at any Postgres
npm test                                # expect 59 passing
npm run profile:check
npm run dev
curl -XPOST localhost:4000/api/discovery/probe -H 'content-type: application/json' \
     -d '{"adapter":"greenhouse","tenant":"postman"}'
curl -XPOST localhost:4000/api/discovery/run
```

**Done when:** real jobs appear on the Jobs page, and the run's failure list has been
used to correct or delete the dead board tokens.

**Expect:** a dependency version pinned wrong, and several dead tokens. Both are cheap.

---

## Step 8 — Evaluator (done, 2026-09-10)

Built and verified against real data — see [01-completed.md](01-completed.md) and D14
in [03-decisions.md](03-decisions.md). Runs via `POST /api/evaluate/run`. Not yet run
against the full 125-job backlog, just incrementally so far.

One known gap: `excluded_company_kinds` (staffing, consultancy_bench) has no data
source — the `companies` table has no `kind` column, so this hard gate never fires.
Harmless today (none of the 3 enabled boards are staffing firms), but needs a real
column + a way to set it (probably an optional `data/boards.md` column) before adding
any staffing/consultancy company to the registry.

---

## Step 9 — Inbox worker (built 2026-09-10, not yet run live)

Code complete and unit-tested — see [01-completed.md](01-completed.md). Blocked on
Google Cloud OAuth credentials from Prasath and a one-time interactive consent step
that must happen on **Vinoth's own machine** (his Gmail, not Prasath's — D12). Full
checklist in [04-open-items.md](04-open-items.md), shared with Google Chat's since
both need a Google Cloud project.

---

## Step 9 — Inbox worker

Daily read-only Gmail scan of **`gopir525@gmail.com`** — Vinoth's mailbox, not Prasath's.

Classify into confirmation / rejection / interview / offer / recruiter / assessment /
action-required / job alert / unrelated. Match to an application by requisition ID, then
ATS thread id, then employer domain plus recent submission window. Anything unmatched
lands on the Updates page rather than being attached to the wrong job.

**Needs:** Gmail OAuth for Vinoth's account. Never replies, archives or deletes.

---

## Step 10 — Adapter health page

Wire the existing table to the dashboard: status, last success, 24h/7d rates, affected
jobs. Mostly display; the recording already happens in discovery.

---

## Step 11 — Playwright browser service

Persistent contexts, one application worker at a time, session reuse, screenshot
capture. No applying yet — navigation and form inspection only.

---

## Step 12 — First ATS: inspect and dry run

Greenhouse or Lever, whichever yields more real jobs. Extract form questions, map to
`personal.md` facts, identify unknowns and raise Chat cards, fill without submitting.

**Done when:** a real form is filled correctly and nothing is submitted.

---

## Step 13 — Evidence

Screenshot storage, confirmation parsing, evidence levels E0–E4, dashboard viewer.
E1 arrives from the inbox worker, so levels rise on their own over the following days.

---

## Step 14 — Retry and recovery

Failure classification, `lock(application_key)`, heartbeats, crash recovery that checks
the candidate dashboard and inbox before assuming anything about submission. The
approval-gated retry flow already exists; this is the machinery around it.

---

## Step 15 — Submission

Assisted first (agent fills, human submits), then autonomous with human-on-stuck.
Prasath has asked for autonomous from the start; see D7 in
[03-decisions.md](03-decisions.md) for the recommendation to run the first ten
assisted anyway.

---

## Step 16 — More adapters

By actual yield, most deterministic first: Ashby, Workday, SmartRecruiters, Amazon,
Microsoft, Naukri, LinkedIn, Indeed. New adapters run in shadow mode before being
enabled. Do not start with LinkedIn or Workday.

---

## Step 17 — Scheduling and analytics

Daily run: inbox scan, adapter health, discovery and applications (60 minute cap,
wind-down at 55), evidence reconciliation. Then conversion analytics by source,
company, resume variant, and cost per submission.
