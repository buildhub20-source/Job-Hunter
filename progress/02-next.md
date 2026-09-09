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

## Step 8 — Evaluator

Hard gates in code first, then LLM ranking only on survivors.

- Stage 1, near-zero cost: duplicate requisition, excluded company, out-of-scope
  geography, seniority words, experience beyond the hard limit, disclosed comp below
  `minimum_ctc`, excluded job types.
- Stage 2: A / B / C / SKIP with reason, confidence, missing info, resume variant.
- Cache on `jd_hash + policy_version` so unchanged JDs are never re-analysed.
- Low confidence routes to review, never to auto-skip.

**Needs:** an LLM API key (first step that does). **Blocks:** everything downstream.

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
