# Completed

Build steps 1–7 of 17. Each entry says what was **verified** versus what is
**written but unproven** — that distinction is the point of this file.

---

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
