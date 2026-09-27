# JobOps Agent — Progress

Living record of what is built, what is next, and why things are the way they are.
Update it at the end of every working session.

| | |
| --- | --- |
| **Last updated** | 2026-09-17 |
| **Commits** | 31 on `master`, latest `3ca761c` |
| **Active line of work** | **v3** — Google Sheet + Apps Script + Netlify dashboard + local Playwright applier ([status](../docs/V3-STATUS.md)) |
| **v3 pipeline** | Live. 225 jobs, 177 pass the gates, 0 applied (2026-09-17) |
| **v3 applier** | Greenhouse dry run verified on 5 live forms. **Nothing submitted yet.** |
| **Tests** | v3 applier: 68 passing · v2: 84 passing |
| **v2** | Steps 1–10 of 17 built and run against live data; kept, not extended |

## The one thing that matters right now

**The first live application.** Five Greenhouse jobs (Speechify, Celonis, GitLab,
Truveta, BitGo) are filled end to end in dry run and checked field by field in the fill
report. GitLab goes first, on Vinoth's go-ahead, from a personal machine (D12):

```
cd v3/applier
npm run apply -- --job-id greenhouse:8736877002 --submit
```

Since the last update (2026-09-13), all committed in `3ca761c`:
- The applier fills real Greenhouse forms correctly, asks Vinoth in Discord when it
  can't answer truthfully (one message per job, options included), writes open-ended
  answers from his resume facts only (D20), and produces a fill report to check.
- Each job gets the resume version its JD fits (D21). The Sheet and the dashboard show
  which one, and the applier uploads it as `Vinoth_M_Resume.pdf`.
- The experience gate fires now that Workday and Amazon postings are enriched.

Waiting on Vinoth: the go-ahead above, approval of the rewritten essay, and consistent
numbers across the resume PDFs ([04-open-items.md](04-open-items.md)).

Day-to-day commands:

```
cd v3/applier
npm run apply -- --limit 5          # dry run: fill, screenshot, don't submit
npm run answers -- --watch          # pick up Discord replies
npm run report                      # screenshots/fill-report.html
npm test
```

After an Apps Script code change: save, then Deploy → Manage deployments → ✏️ →
**Version: New version** → Deploy. The dashboard redeploys on push to `master`.

To bring the v2 stack up after a reboot: `npm run db:up && npm run dev`.

## Index

- [01-completed.md](01-completed.md) — what exists, per step, and what was actually verified
- [docs/V3-STATUS.md](../docs/V3-STATUS.md) — the v3 system: phases, numbers, bugs, next
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
7. Questions go to a human (Google Chat in v2, Discord in v3); state goes to the dashboard.
