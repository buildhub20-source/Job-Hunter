# JobOps Agent v2 — Progress

Living record of what is built, what is next, and why things are the way they are.
Update it at the end of every working session.

| | |
| --- | --- |
| **Last updated** | 2026-09-10 |
| **Commits** | 8 |
| **Source files** | 101 |
| **Packages** | shared · db · profile · chat · approvals · adapters · discovery · evaluator |
| **Build steps done** | 1–8 of 17 |
| **Tests** | 74 written · **74 executed and passing** |
| **Typecheck** | clean across all 10 workspaces |
| **Ever run end to end** | **Yes** — Postgres up, migrated; real discovery run (125 jobs) and real evaluator run both completed against live data |

## The one thing that matters right now

Steps 0 and 8 are both done. Discovery has put 125 real jobs in the database; the
evaluator (hard gates + LLM ranking) is wired up and has correctly judged real postings
— see [01-completed.md](01-completed.md) for what it caught. LLM calls run on Prasath's
Claude Pro/Max login via the Claude Code CLI, not a paid API key — see D14 in
[03-decisions.md](03-decisions.md) for why and what broke getting there. Next real work
is **step 9, the Gmail inbox worker** — needs Gmail OAuth for `gopir525@gmail.com` (see
[04-open-items.md](04-open-items.md)).

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
