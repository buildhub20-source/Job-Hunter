# Open Items

Blockers, unknowns, and what's needed from whom. Clear these before they compound.

---

## Blocking everything

### Nothing has ever run
Eight commits, 93 source files, four build phases — never installed, never executed
against a database. 41 of 59 tests have run, all of them pure logic on flattened copies.
The npm registry is blocked from both shells available to Claude, so this can only be
done by Prasath.

```
npm install && npm run db:up && npm run db:migrate && npm test && npm run dev
```

Paste the output, errors included. Expect at least one wrong dependency pin.

### The repo exists in exactly one place
Local git, branch `master`, **no remote, nothing pushed**. One disk failure loses
everything. A private repo is the fix — `data/personal.md` holds Vinoth's DOB, phone,
salary and citizenship, and it's already in the committed history, so it must not be a
public repo without rewriting history first.

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
| `npm install` + migrate output | Everything |
| Private git remote | Nothing yet, but the repo is unbacked |
| Target companies for `data/boards.md` | Discovery quality |
| LLM API key | Step 8 |
| Google Chat space, service account, project number | Real approvals (stub works meanwhile) |
| Gmail OAuth for `gopir525@gmail.com` | Step 9 |

---

## Known unverified

- **All 10 board tokens in `data/boards.md`** are guesses. A wrong one returns HTTP 404
  and appears in the run's failure list — the first discovery run is the verification pass.
- **The Google Chat transport** has never talked to Google. Only the stub path has run.
- **The webhook JWT verification** is written against Google's documented format but has
  never seen a real token.
- **Every SQL migration.** 24 tables, never applied.
- **Every API route.** Never served a request.

## Known annoyances

- `_to_delete/gitlocks/` accumulates stale git lock files, because Claude's shell can't
  delete files on the device and the delete permission request was blocked. Safe to
  remove by hand; harmless otherwise. Git from a normal Windows terminal is unaffected.
- File transfers into the repo have silently written stale content once. Every transfer
  since is verified by hash or content check before being trusted.
