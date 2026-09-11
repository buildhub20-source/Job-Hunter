# JobOps Agent v2 — Progress

Living record of what is built, what is next, and why things are the way they are.
Update it at the end of every working session.

| | |
| --- | --- |
| **Last updated** | 2026-09-11 |
| **Commits** | 8 (more uncommitted — see below) |
| **Source files** | 116+ |
| **Packages** | shared · db · profile · chat · approvals · adapters · discovery · evaluator · llm · inbox |
| **Build steps done** | 1–9 of 17 |
| **Tests** | 84 written · **84 executed and passing** |
| **Typecheck** | clean across all 12 workspaces |
| **Ever run end to end** | **Yes** — Postgres, discovery (13 boards), evaluator, all run against live data. Gmail credentials exist but the scan hasn't been run live yet this session. |

## The one thing that matters right now

Two things happened since the last commit that aren't reflected in git yet:

1. **A real correctness bug, found and fixed**: the geography hard gate ignored the
   jobcard's already-correct `country` field and re-derived it from raw location text,
   so cities like "Bengaluru" (no literal "India" in the string) were wrongly rejected.
   Three already-evaluated jobs had this wrong verdict; corrected in the database and
   re-evaluated. See [01-completed.md](01-completed.md).
2. **A "v3" redesign proposal** exists at [docs/V3-SparkFlow.md](../docs/V3-SparkFlow.md)
   — replace Postgres/ATS-adapters with Sheets + Gemini Spark + Apps Script. Explicitly
   marked design-not-built. **This is an open fork, not a decided direction** — see
   [04-open-items.md](04-open-items.md).

Also since the last commit: Gmail OAuth is fully wired (credentials in `secrets/`),
`data/boards.md` grew to 13 enabled boards, Google Chat's auth was rewritten around
Application Default Credentials because this org blocks service-account key downloads
(D16), and a Funnel analytics page was added to the dashboard.

None of this is committed. Working tree has real, tested changes sitting uncommitted —
commit them before doing anything else, so a crash doesn't lose them again.

To bring the stack up again after a reboot:

```
npm run db:up
npm run dev
```
(Migrations only need re-running if `db/migrations/` gets a new file — `docker compose`
keeps the data volume across restarts.)

## Index

- [01-completed.md](01-completed.md) — what exists, per step, and what was actually verified
- [02-next.md](02-next.md) — remaining steps in order, with what each needs
- [03-decisions.md](03-decisions.md) — decisions taken and why, so they aren't relitigated
- [04-open-items.md](04-open-items.md) — blockers, unknowns, and what's needed from whom

## Ground rules that must not be broken

1. `UNKNOWN` never becomes `no`, `0`, or `N/A`.
2. Only `employer + ats_tenant + requisition_id` blocks a duplicate.
3. No retry without approval. Maximum three.
4. No verified submission without evidence.
5. Human verification gates stay human — notify, never attempt.
6. Personal information lives in `data/personal.md` and nowhere else.
7. Questions go to Google Chat; state goes to the dashboard.
