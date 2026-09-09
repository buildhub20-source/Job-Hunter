# JobOps Agent v2

A personal job-search operating system. Discovers roles, verifies them against the
employer's own posting, ranks them, fills applications from approved facts only, and
stops to ask whenever it does not know something.

**Operating principle: automate execution, never invent intent.**
See `docs/CorePlan.md` for the full spec.

## Where things live

| Thing | Home | Why |
| --- | --- | --- |
| Personal facts | `data/personal.md` | Hand-editable, Git-versioned, **never in the database** |
| Policies | `data/policies/*.md` | Hard gates and ranking signals, versioned by content hash |
| Operational state | PostgreSQL | Jobs, applications, approvals, evidence, runs, audit |
| Questions to you | Google Chat | Answer immediately from your phone (step 5) |
| Control + status | The dashboard | Start runs, switch modes, see what happened |

## Quick start

```bash
cp .env.example .env          # then edit DATABASE_URL if you are not using Docker
npm install

npm run db:up                 # optional: starts Postgres in Docker
npm run db:migrate

npm run profile:check         # validates data/personal.md and the policy files
npm test                      # idempotency + "UNKNOWN is not NO" tests

npm run dev                   # API on :4000, dashboard on :3000
```

No Docker? Point `DATABASE_URL` at any Postgres 14+ and run `npm run db:migrate`.
The dashboard renders without a database — it shows a banner instead of numbers.

## What works today (steps 1–4)

- npm workspaces monorepo, TypeScript throughout
- Full Postgres schema with the duplicate-blocking constraint on confirmed submissions
- `personal.md` / policy loader, validator, and Git-committing write-back
- Dashboard: run control, live stats, profile editor, policy viewer, and the
  Jobs / Applications / Updates / Approvals / Runs / Adapters / Audit views
- Tests for the identity matrix and the unknown-handling rules

## Not built yet

Steps 5–17 in the plan: Google Chat approvals, notifications, discovery adapters,
the evaluator, the inbox worker, Playwright, evidence capture, and the retry engine.
The schema and the dashboard pages for all of them already exist and read empty.

## The rules that must not be broken

1. `UNKNOWN` never becomes `no`, `0`, or `N/A`.
2. Only `employer + ats_tenant + requisition_id` blocks a duplicate. Same title, same
   JD and same company are not duplicates.
3. No retry without an approval. Maximum three.
4. No verified submission without evidence.
5. Human verification gates (CAPTCHA, assessments, ID checks) stay human — notify, never attempt.
6. Personal information lives in `personal.md` and nowhere else.
