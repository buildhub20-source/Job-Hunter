# Open Items

Blockers, unknowns, and what's needed from whom. Clear these before they compound.

---

## Nothing is blocking step 0 anymore

Resolved 2026-09-10, after the WSL2 restart: Postgres is up, migrated (26 tables), and a
real discovery run has completed (125 jobs from Postman/Razorpay/Druva). See
[01-completed.md](01-completed.md) for the two dotenv/cwd bugs found and fixed along the
way. Bringing the stack back up after a reboot is just:

```
npm run db:up
npm run dev
```

## Blocking everything now

### ~~Step 8 (evaluator) needs an LLM API key~~ — resolved, on Pro/Max instead
Built 2026-09-10 against the Claude Code CLI on Prasath's own Pro/Max login rather than
waiting on API billing (his generated key has a zero credit balance — never funded).
See D14 in [03-decisions.md](03-decisions.md). If the API key gets funded later,
switching stage 2 back to direct API calls is a contained change in
`packages/evaluator/src/llm.ts` only, not a re-architecture.

### Step 9 (inbox worker) needs Gmail OAuth for `gopir525@gmail.com`
The next real build step can't start without it. From Prasath.

### ~~The repo exists in exactly one place~~ — resolved, now public (intentional)
Pushed 2026-09-10 to `github.com/buildhub20-source/Job-Hunter`. Backed up off this one
machine. **Repo is public** — Prasath made this choice explicitly and confirmed it after
being told `data/personal.md` (Vinoth's DOB, phone, salary, citizenship) is in the
committed history and would be visible to anyone. Not a mistake to fix; a decision to
respect. See D13 in [03-decisions.md](03-decisions.md).

### Operation needs to move off the work laptop
Building here is fine. Signing into Vinoth's Gmail, driving browsers into job portals and
submitting live applications on Aptean hardware is not — see D12.

---

## Needed from Vinoth

| Item | Why it matters |
| --- | --- |
| **US sponsorship** — does he hold US citizenship or a green card? | Settles `requires_sponsorship_us`. If no, the honest answer is Yes; see D8. |
| **Date of birth format** — is `08/12/2003` 8 December? | Stored as 2003-12-08. Wrong on a form is worse than absent. |
| **Travel percentage** | Currently 25%, marked `source=default` — Claude's choice, not his answer. It's a real commitment if asked at interview. |
| **Walk-away CTC** | `minimum_ctc` is 600000, equal to the ask. If he'd take 5.75L for the right role, the gate is currently deleting those jobs. |
| **Chat space membership** | He answers his own approval cards, so he needs to be in the space. |

## Needed from Prasath

| Item | Blocks |
| --- | --- |
| ~~`npm install` + migrate output~~ | Done 2026-09-10 |
| ~~Git remote~~ | Done 2026-09-10 — pushed, public (intentional, see D13) |
| Target companies for `data/boards.md` | Discovery quality |
| ~~LLM API key~~ | Not currently needed — step 8 runs on Pro/Max, see D14 |
| Google Chat space, service account, project number | Real approvals (stub works meanwhile) |
| Gmail OAuth for `gopir525@gmail.com` | Step 9 |

---

## Known unverified

- **Board tokens** — resolved 2026-09-10. All 10 original guesses probed directly against
  the real Greenhouse/Lever APIs (no app needed). 3 are real and enabled: `postman` (67
  jobs), `razorpay` (23 jobs, tenant and adapter both corrected), `druva` (38 jobs). The
  other 7 are on ATS platforms this codebase doesn't support yet (SmartRecruiters,
  Workday, Workable, Gem, Kula, or no ATS at all) — disabled, not deleted, with the real
  platform noted in `data/boards.md` for step 16.
- **The Google Chat transport** has never talked to Google. Only the stub path has run.
- **The webhook JWT verification** is written against Google's documented format but has
  never seen a real token.

## Known annoyances

- `_to_delete/gitlocks/` accumulates stale git lock files, because Claude's shell can't
  delete files on the device and the delete permission request was blocked. Safe to
  remove by hand; harmless otherwise. Git from a normal Windows terminal is unaffected.
- File transfers into the repo have silently written stale content once. Every transfer
  since is verified by hash or content check before being trusted.
