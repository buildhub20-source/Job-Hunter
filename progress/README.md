# JobOps Agent v2 — Progress

Living record of what is built, what is next, and why things are the way they are.
Update it at the end of every working session.

| | |
| --- | --- |
| **Last updated** | 2026-09-10 |
| **Commits** | 8 |
| **Source files** | 116 |
| **Packages** | shared · db · profile · chat · approvals · adapters · discovery · evaluator · llm · inbox |
| **Build steps done** | 1–9 of 17 (9 built and tested, not yet run against live Gmail) |
| **Tests** | 83 written · **83 executed and passing** |
| **Typecheck** | clean across all 12 workspaces |
| **Ever run end to end** | **Yes** — Postgres up, migrated; real discovery run (125 jobs) and real evaluator run both completed against live data |

## The one thing that matters right now

Steps 0, 8, and 9 are all built. Discovery has put 125 real jobs in the database; the
evaluator (hard gates + LLM ranking) has judged them; the inbox worker (classification +
matching) is code-complete and unit-tested but has never touched real Gmail — see
[01-completed.md](01-completed.md). Both LLM stages share one mechanism
(`@jobops/llm`): the Claude Code CLI on the operator's own Pro/Max login, not a paid API key
— see D14 in [03-decisions.md](03-decisions.md).

Next real work is wiring up real Google Chat and Gmail — both blocked on the same
Google Cloud Console checklist in [04-open-items.md](04-open-items.md). One piece of
that (the Gmail consent step) has to happen on **Vinoth's own machine**, not this one.

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
