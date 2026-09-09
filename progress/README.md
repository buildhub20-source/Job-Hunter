# JobOps Agent v2 — Progress

Living record of what is built, what is next, and why things are the way they are.
Update it at the end of every working session.

| | |
| --- | --- |
| **Last updated** | 2026-09-09 |
| **Commits** | 8 |
| **Source files** | 93 |
| **Packages** | shared · db · profile · chat · approvals · adapters · discovery |
| **Build steps done** | 1–7 of 17 |
| **Tests** | 59 written · **41 executed and passing** · 18 blocked on `npm install` |
| **Ever run end to end** | **No** — see [04-open-items](04-open-items.md) |

## The one thing that matters right now

Nothing has been installed or executed against a real database. Four build phases are
written and typed but unproven. Before step 8 is worth starting:

```
npm install
npm run db:up && npm run db:migrate
npm test
npm run dev
curl -XPOST localhost:4000/api/discovery/run
```

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
