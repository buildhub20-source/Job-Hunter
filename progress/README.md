# JobOps Agent v2 — Progress

Living record of what is built, what is next, and why things are the way they are.
Update it at the end of every working session.

| | |
| --- | --- |
| **Last updated** | 2026-09-10 |
| **Commits** | 8 |
| **Source files** | 93 |
| **Packages** | shared · db · profile · chat · approvals · adapters · discovery |
| **Build steps done** | 1–7 of 17 |
| **Tests** | 59 written · **59 executed and passing** |
| **Typecheck** | clean across all 9 workspaces |
| **Ever run end to end** | **Yes** — Postgres up, migrated, real discovery run completed: 125 jobs from Postman/Razorpay/Druva now in the database |

## The one thing that matters right now

Step 0 is done. `npm install`, `npm test`, `npm run typecheck`, `npm run profile:check`,
`npm run db:up`, `npm run db:migrate`, both dev servers, and a real
`POST /api/discovery/run` all work — see [01-completed.md](01-completed.md). Next real
work is **step 8, the evaluator** — needs an LLM API key from Prasath (see
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
