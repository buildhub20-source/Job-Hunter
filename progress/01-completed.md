# Completed

Build steps 1–7 of 17. Each entry says what was **verified** versus what is
**written but unproven** — that distinction is the point of this file.

---

## Step 0 (partial) — Install and run, 2026-09-10

`npm install` succeeded (registry access was the earlier blocker, now resolved).

- ✅ `npm test` — **all 59 tests pass**, up from 41 flattened-copy runs.
- ✅ `npm run typecheck` — clean across all 9 workspaces, no errors.
- ✅ `npm run profile:check` — 41 facts (39 usable), 33 policy rows (10 hard gates, 23
  ranking), policy version computed. Found and fixed a real bug:
  [`packages/profile/src/cli.ts`](../packages/profile/src/cli.ts) defaulted
  `JOBOPS_DATA_DIR` to `./data`, correct only if run from the repo root — but an npm
  workspace script's cwd is the package directory, so it always threw `ENOENT`. Fixed to
  `../../data`, matching the pattern already correct in `apps/api/src/config.ts`.
- ✅ **All 3 live-enabled board tokens verified against the real Greenhouse API**
  (`boards-api.greenhouse.io`), no app or database needed: `postman` (67 jobs), `druva`
  (38 jobs). `razorpay`'s guessed tenant was wrong (404); the real one,
  `razorpaysoftwareprivatelimited`, returns 23 jobs. Adapter was also wrong — Razorpay is
  Greenhouse, not Lever. See [data/boards.md](../data/boards.md) for the other 7 tokens,
  all confirmed dead and disabled (not deleted) with the real ATS each company uses.
- ❌ Still unproven at the time: the database. Resolved below, same day, after restart.

## Step 0 (partial, continued) — API and dashboard actually run, 2026-09-10

Both servers started for the first time ever (`.claude/launch.json` added), against the
data files, with no database. `apps/dashboard/package.json`'s `dev` script had a
hardcoded `-p 3000`; removed so it can pick another port when 3000 is taken.

- ✅ API (`localhost:4000`) serves real requests: `/api/profile`, `/api/policies`,
  `/api/boards`, `/api/discovery/probe`, `/api/adapters/healthcheck` all return correct
  data. None of these touch Postgres.
- ✅ Found and fixed a real bug via the healthcheck route:
  [`greenhouse.ts`](../packages/adapters/src/greenhouse.ts)'s health check hit a
  hardcoded third-party tenant (`vaultsecurity`) as "known to exist" — it had gone 404
  (renamed/closed), so the healthcheck reported `greenhouse: false` even though the
  adapter and postman/druva/razorpay all work fine. Swapped the reference to our own
  verified `postman` board, which we control and already know is live.
- ✅ Dashboard (`next dev`, WASM fallback — see below) renders all 10 pages. Overview,
  Policies and Profile work fully end-to-end (Profile confirmed all 41 facts render
  correctly with edit affordances). The other 7 pages (Jobs, Applications, Runs, Adapter
  health, Approvals, Audit, Updates) fail gracefully with "Postgres is not reachable
  yet." — no crashes, no blank screens.
- ⚠️ **Environment note**: this laptop's Application Control policy blocks the native
  `@next/swc-win32-x64-msvc` binary (`An Application Control policy has blocked this
  file`). Next.js falls back to `@next/swc-wasm-nodejs` automatically — works, just a
  ~50s slower cold start. Worth knowing if dev startup ever looks hung.

## Step 0 (complete) — database up, migrated, first real discovery run, 2026-09-10

After the WSL2 restart: Docker Desktop started clean, `npm run db:up` pulled and started
`postgres:16-alpine`, `npm run db:migrate` applied both migrations — **first time ever**,
26 tables now exist.

- ✅ Found and fixed a repo-wide bug, same class as the profile CLI one from earlier
  today: `packages/db/src/pool.ts`, `apps/api/src/config.ts`, and
  `packages/profile/src/cli.ts` all did `import 'dotenv/config'`, which only loads
  `.env` from `process.cwd()`. Every npm workspace script runs with cwd set to the
  package directory, so `.env` (and therefore `DATABASE_URL`) was silently never found —
  `db:migrate` failed with "DATABASE_URL is not set" even though `.env` was correct.
  Fixed all three to resolve `.env`, `JOBOPS_DATA_DIR`, and `JOBOPS_REPO_ROOT` relative
  to each file's own location (`import.meta.url`) rather than `process.cwd()` or a
  relative default — robust regardless of which directory a script is invoked from.
  [pool.ts](../packages/db/src/pool.ts), [config.ts](../apps/api/src/config.ts),
  [cli.ts](../packages/profile/src/cli.ts).
- ✅ `POST /api/discovery/run` — **first real discovery run**: 3 boards (postman,
  razorpay, druva), 128 fetched, **125 inserted**, 3 duplicates caught, 0 failures.
- ✅ Dashboard Jobs page renders all 125 postings correctly — company, title, requisition
  ID, state `DISCOVERED`, identity source `requisition_id`, identity reliable `yes`.
- ✅ Overview page live stats: `discovered_today: 125`, everything else correctly 0
  (evaluator doesn't exist yet — step 8).
- ✅ Adapter Health page shows `greenhouse: Healthy`. No `lever` row, correctly — no
  Lever board is currently enabled (see the boards.md disable list above).
- ✅ `npm test` (59/59) and `npm run typecheck` (all 9 workspaces) still clean after
  all fixes.

---

## Step 8 — Evaluator, 2026-09-10

`@jobops/evaluator`. Stage 1 hard gates as pure, policy-data-driven functions (company
exclusion, current employer, experience floor/ceiling, geography + remote-anywhere,
blocked seniority words, blocked job types, INR salary floor) — run in policy `priority`
order, first failure wins as the SKIP reason. Resume variant selection
(`employer_override_then_default`) is a deterministic lookup, not asked of the model.
Stage 2 LLM ranking runs against real DISCOVERED jobs via `POST /api/evaluate/run`.

**The LLM call runs on the operator's Claude Pro/Max login via the Claude Code CLI, not a
paid API key** — the generated API key has no credit balance. See D14 in
[03-decisions.md](03-decisions.md) for the tradeoff that was flagged and accepted, and
three real bugs found building this: a permission-classifier block from flags that
looked like unattended permission-bypass, `execFile` unable to spawn `npx`'s `.cmd`
shim on Windows without a shell, and the API server's own `.env` leaking
`ANTHROPIC_API_KEY` into the child process so the CLI silently billed the (empty)
API key instead of using the OAuth login.

- ✅ Verified against real data: state-machine transitions
  (`DISCOVERED → SKIPPED` on a hard-gate failure, `DISCOVERED → VERIFIED → EVALUATED`
  on survival), with a job stuck mid-pipeline by an earlier bug correctly resumed from
  `VERIFIED` rather than re-run from scratch.
- ✅ The LLM stage correctly skipped two jobs that passed stage 1 by keyword coincidence
  but aren't engineering roles at all (an Account Executive, a Service Desk Specialist)
  — it even named the false-positive hard-gate match as part of its reasoning.
- ✅ Cache on `jd_hash + policy_version` confirmed: a second identical pass records 0
  new evaluations, all cache hits.
- ✅ 15 new hard-gate unit tests, 74/74 total passing, typecheck clean across all 10
  workspaces.
- ✅ Run against the full 125-job backlog (incrementally, to watch Pro/Max quota —
  turned out unnecessary, see below). Final split: **123 hard-gate skipped, 2 LLM
  survivors, both correctly judged SKIP**. Hard-gate breakdown: 79 experience floor
  (role wants more years than the 3-year cap), 28 geography, 16 seniority title. This
  reflects real data, not a bug — Postman/Razorpay/Druva's current listings skew
  senior and international; a 2.2-year India-based candidate has little overlap with
  this specific board set today. Improving on this is a `data/boards.md` problem
  (better company targeting, step 16 for more ATS platforms), not an evaluator problem.

---

## Step 9 — Inbox worker, 2026-09-10

`@jobops/inbox`. Deterministic subject/snippet classification first (rejection
language checked before interview language, so "unfortunately, after your interview…"
doesn't get misread), LLM fallback only when inconclusive — same token-discipline
pattern as the evaluator, and it now shares that plumbing: pulled the "call Claude Code
CLI headless" mechanism out of `@jobops/evaluator` into a new `@jobops/llm` package
so this and the evaluator both use one implementation, one place to fix if it breaks.

Matching: requisition ID extracted from subject/snippet, then employer-domain +
30-day submission window. The plan's third tier (ATS thread/message ID) isn't
implemented — nothing in the schema stores one yet, so there's nothing to match
against. Unmatched mail is stored, not guessed onto the wrong application.

State transitions respect `canTransition` from `@jobops/shared` — a classification
that isn't a legal move from the application's current status just gets recorded and
notified, never forced. One real gap this surfaced: the state machine only allows
entering `BLOCKED_HUMAN` from `APPLYING`, but an assessment-link email routinely
arrives after an application already shows `SUBMITTED_UNVERIFIED` — so assessment
emails today notify without transitioning state. `job_alert` messages ("hand to
discovery as a source") are stored but not fed back into discovery — no code reads an
email into a posting yet.

- ✅ 9 new unit tests (classification precedence, requisition-ID extraction), 83/83
  total passing, typecheck clean across all 12 workspaces.
- ✅ `POST /api/inbox/scan` registered and fails with a clear, specific error
  (`GMAIL_OAUTH_CLIENT_PATH is not set`) rather than crashing — proves the wiring
  without live credentials.
- ❌ Never run against real Gmail. Needs a Google Cloud OAuth client from the operator, and
  the one-time interactive consent (`npm run authorize -w @jobops/inbox`) has to happen
  on **Vinoth's own machine**, not this one — it's his Gmail login, see D12. See
  [04-open-items.md](04-open-items.md) for the full checklist, shared with Google Chat's.

## Steps 1–4 — Foundation · commit `df5c37f`

**Monorepo.** npm workspaces (not pnpm — nothing extra to install), TypeScript
throughout, Node ≥ 20.

**Database.** PostgreSQL, 24 tables across two migrations. The duplicate rule is a
partial unique index on `application_key`, scoped to confirmed submissions only, so a
failed attempt never blocks a legitimate retry.

**`personal.md` loader.** Markdown-table parser, zod validation, expiry handling,
Git-committing write-back. Personal data never enters the database, not even as a cache.

**API.** Fastify — profile and policy reads, fact upsert, stats, run control.

**Dashboard.** Next.js, 10 pages: Overview with run control and live stats, inline
profile editor, policy viewer, Jobs, Applications, Updates, Approvals log, Runs,
Adapter Health, Audit.

- ✅ Verified: identity matrix, state machine, markdown round-trip with escaped pipes
- ❌ Unproven: the schema has never been applied; no API route has ever served a request

---

## Steps 5–6 — Google Chat approvals and notifications · commit `0a1678e`

**`@jobops/chat`.** Cards v2 builders, interaction parser, both transports. The Google
transport does the service-account JWT flow by hand — no new dependencies.

**Webhook verification.** RS256 against Google's published certs (~60 lines,
`node:crypto`). The endpoint can answer approvals on Vinoth's behalf, so it refuses
every request when neither `GCHAT_PROJECT_NUMBER` nor `GCHAT_WEBHOOK_SECRET` is set.

**`@jobops/approvals`.** Scope and retry rules as pure functions, the service that
raises and resolves approvals, permanent write-back into `personal.md`, the retry flow,
and the notification channel with helpers per blocked case.

**Runs with no credentials.** `StubTransport` prints the card to the API console with
the exact curl to answer it, through the same code path a real button uses.

- ✅ Verified: 24 tests — scope isolation, retry cap, no-reply-is-not-an-answer,
  forged-scope rejection, HTML injection from a hostile JD
- ❌ Unproven: the service layer, the routes, and the real Google transport

---

## Step 7 — Greenhouse and Lever discovery · commit `7c55ddf`

**`@jobops/adapters`.** `DiscoveryAdapter` interface, both public board APIs (no auth),
and pure normalisation: title, location, remote type, experience range, skills,
compensation. Board registry read from `data/boards.md`.

**`@jobops/discovery`.** RawPosting → JobCard, identity resolution through the fallback
ladder, dedupe-aware ingest, job families, adapter health recording.

**Endpoints.** `POST /api/discovery/run`, `/probe` (fetch one board without touching the
database), `/adapters/healthcheck`, `GET /api/boards`.

**Two bugs found by the tests, both silent data corruption:**
- Greenhouse returns its HTML escaped once. Tags were stripped before entities were
  decoded, so every JD would have stored literal `<p>` markup — which then feeds the
  evaluator and skill extraction.
- Title normalisation only removed level markers at the end of a string, so
  `Software Engineer I, Platform` and `Software Engineer, Platform` landed in different
  job families.

- ✅ Verified: 17 parser tests against captured API fixtures
- ❌ Unproven: ingest against a real database; **all 10 board tokens are unverified guesses**

---

## Profile and policy data

| File | State |
| --- | --- |
| `data/personal.md` | 41 facts, **39 usable**, 2 open. Subject is Vinoth M. |
| `data/policies/targeting.md` | 14 rows. Equal stack weights, salary floor active at 600000. |
| `data/policies/exclusions.md` | 6 rows. Staffing and Aptean excluded. |
| `data/policies/resumes.md` | Base + per-employer override, 9 companies mapped. |
| `data/boards.md` | 10 boards, all unverified. |
| `data/resumes/` | 10 PDFs, verified by hash after transfer. |

## Test ledger

| Suite | Written | Executed | Notes |
| --- | --- | --- | --- |
| `adapters/parse` | 17 | 17 ✅ | Greenhouse + Lever fixtures, normalisation |
| `chat/chat` | 13 | 13 ✅ | Cards, parser, injection, forged scope |
| `approvals/policy` | 11 | 11 ✅ | Scope isolation, retry cap, expiry |
| `shared/identity` | 8 | — | Ran as a flattened equivalent; needs `npm install` |
| `profile/load` | 10 | — | Needs zod |

Executed suites were run with `node --experimental-strip-types` on flattened copies,
because the npm registry is blocked from both available shells.
