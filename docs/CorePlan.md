# JobOps Agent v2 — Core Plan

**Status:** Working build spec (condensed from the 52-section baseline)
**Scope:** Only what is required to build and run v1. Everything optional or illustrative was removed.

---

## 1. Principle

> **Automate execution, never invent intent.**

- Approved fact exists → use it.
- Fact missing, ambiguous, conflicting, sensitive, or a new decision → stop and ask in Google Chat.
- **UNKNOWN is never NO.** It must not decay into false / zero / N/A.

---

## 2. What it does

1. Discover jobs from multiple sources.
2. Verify each role against the employer's official posting.
3. Normalize into a compact JobCard.
4. Score against `personal.md` + policies → A / B / C / SKIP.
5. Block duplicates by requisition identity only.
6. Fill applications using approved facts only.
7. Ask anything undefined in Google Chat and wait for the reply.
8. Notify on any human-only block (CAPTCHA, assessment, ID check).
9. Capture evidence (screenshot + confirmation) for every submission.
10. Check mail daily for employer/recruiter updates and surface them on the dashboard.
11. Keep durable history so the next run knows what happened.

---

## 3. Components

| Component | Job |
|---|---|
| Orchestrator | Run state, phase, priority, time budget |
| Discovery workers | Source → JobCards |
| Verifier | Confirm the role on the official source |
| Evaluator | Hard gates (code) then LLM tiering |
| Approval engine | Undefined/conflicting answers → **Google Chat**, blocking answers |
| Notifier | Push "blocked / needs you" alerts to Google Chat |
| Application worker | Playwright form fill |
| Evidence worker | Confirmation + screenshot capture |
| **Inbox worker** | Daily mail scan → status updates + email evidence |
| Recovery manager | Failure classification, approved retries, crash resume |
| Dashboard | **Control + stats/status display** (Next.js) |
| Store | Postgres for operational state; `personal.md` + policy `.md` for everything human-authored |

---

## 4. Stack (decided)

- **Dashboard:** Next.js + React + TypeScript + Tailwind. SSE for live run status.
- **Backend:** Node.js + TypeScript (Fastify). Python only later, where it earns its place.
- **Database:** PostgreSQL — operational state only.
- **Approvals & alerts:** Google Chat API — interactive cards in a dedicated space, webhook receives the reply.
- **Mail:** Gmail API, read-only scan on a daily schedule.
- **Queue:** Postgres-backed polling. No Redis until scale demands it.
- **Browser:** Playwright, persistent contexts, one application worker at a time.
- **Evidence storage:** local directory first; object storage later.
- **Secrets:** encrypted vault file, decryption key stored separately. Never in prompts, Git, logs, screenshots, chat messages, or the dashboard.

### Source of truth split

- **`personal.md`** — every personal fact: name, phone, email, education, employment history, notice period, expected salary, target location, work authorization, and every answer approved as permanent. **This file is the only home for personal information. It is never copied into the database, not even as a cache.** Workers read it at run start and hold it in process memory for the run.
- **Policy `.md` files** — target titles, salary floor, excluded companies, experience range, remote preference, application caps, resume variant definitions.
- **Postgres** — jobs, evaluations, applications, approvals (as events, not as an inbox), evidence, inbox messages, runs, retries, adapter health, token usage, audit.

Rule: if a human writes it, it lives in markdown and is versioned in Git. If the system generates it, it lives in Postgres.

---

## 5. Facts and policies

**Fact** (a line in `personal.md`):
```
key | value | source | approved | approved_at | expires_at | sensitivity | notes
```

**Policy**:
```
rule | scope | priority | type (hard_gate | ranking_signal) | effective_date | version
```

Hard gates and ranking signals must stay separate and never be merged.

A permanent approval given in Google Chat writes back to `personal.md` or the policy file, bumps its version, and commits. The database records only that the write happened.

---

## 6. Identity and duplicates

```
application_key = canonical_employer_id + ats_tenant_id + requisition_id
```
Unique constraint on confirmed submissions.

Fallback order when no requisition ID: employer job ID → canonical ATS URL → normalized posting URL → composite fingerprint. If none is reliable, ask in Google Chat rather than risk a duplicate.

- Same title ≠ duplicate. Same JD ≠ duplicate. Same company ≠ duplicate.
- Only the same requisition is blocked.

Job families (employer + normalized title + JD fingerprint) exist for grouping, analytics, and resume reuse — **never** for suppression.

---

## 7. Job state machine

```
DISCOVERED → VERIFIED → EVALUATED
   ├─ SKIPPED
   ├─ WAITING_APPROVAL → APPROVED          (question sent to Google Chat)
   └─ QUEUED_TO_APPLY → APPLYING
         ├─ PARKED / BLOCKED_HUMAN          (notification sent to Google Chat)
         ├─ RETRY_APPROVAL_REQUIRED
         ├─ FAILED → NEEDS_HUMAN_REVIEW
         └─ SUBMITTED_UNVERIFIED → SUBMITTED_VERIFIED
               → INTERVIEW | REJECTED | OFFER | WITHDRAWN
```

Transitions after submission are usually driven by the inbox worker. Every transition writes an audit row.

---

## 8. JobCard

The only job representation reasoning workers ever see.

```json
{
  "employer_id": "amazon",
  "company_name": "Amazon",
  "title": "Software Development Engineer I",
  "requisition_id": "3121001",
  "ats": "amazon_jobs",
  "location": ["Bengaluru", "India"],
  "remote_type": "onsite",
  "experience_min": 1,
  "experience_max": 3,
  "required_skills": ["C#", ".NET", "AWS"],
  "compensation_min": null,
  "currency": null,
  "work_authorization_text": null,
  "source_url": "...",
  "official_url": "...",
  "job_family_hash": "...",
  "jd_hash": "...",
  "verified_at": "..."
}
```

---

## 9. Decision engine

**Stage 1 — deterministic code (near-zero tokens):** duplicate requisition, excluded company, out-of-scope geography, disallowed seniority, experience beyond hard limit, disclosed comp below floor, excluded job type.

**Stage 2 — LLM, only on survivors.** Returns:
```
tier (A|B|C|SKIP), reason, missing_info[], confidence, resume_variant, approval_needs[]
```

Apply order A → B → C. SKIP records exactly one primary reason. **Low confidence routes to review, never to auto-skip.**

---

## 10. Approvals over Google Chat

All approval questions go to a dedicated Google Chat space. The dashboard does **not** host an approval inbox.

**Message format** — one interactive card per question:
```
Company · Role · Requisition
The exact question, as the employer worded it
What I already know (from personal.md)
Why I can't answer it myself
[ Yes ] [ No ] [ Type an answer ]
Scope:  ( ) This job   ( ) This run   ( ) Save permanently
```

**Flow:** worker blocks → card posted → reply captured by webhook → answer written to the DB (and to `personal.md` if scope is permanent) → job resumes on the next orchestrator tick. The agent keeps working other jobs the whole time.

**Reply rules**
- No reply within the run window → job stays parked, carries to the next run. Never guessed.
- A `This job` answer never leaks to another job.
- Every card and reply is logged as an approval event and shown read-only on the dashboard.

**Approval types:** information (undefined question) · conflict (sources disagree) · retry (before every retry) · action (human-only gate).

### Blocked notifications

Separate from approvals — these can't be answered in chat, they just need you at the browser:

| Trigger | Message |
|---|---|
| CAPTCHA | "Blocked on CAPTCHA — Amazon SDE I, req 3121002. Open the dashboard." |
| Assessment / coding test | Same, with the assessment link |
| ID / biometric / liveness check | Same |
| Login or session expired | Names the adapter |
| Adapter broken | Names the adapter and error |
| Retry 3 exhausted | Job moved to NEEDS_HUMAN_REVIEW |

Each notification carries a deep link into the relevant dashboard page. Human verification gates stay human — the agent never attempts them.

---

## 11. Application worker

Before filling:
1. Confirm unique requisition and acquire `lock(application_key)`.
2. Load only the required facts from `personal.md` and the relevant policy rules.
3. Select resume variant.
4. Inspect the form and extract questions.
5. Identify unknown fields → post approval cards to Google Chat.
6. Only then fill.

**Assisted mode is the default for v1:** the agent fills and stops; Prasath reviews and submits. Auto-submit is unlocked per-ATS only after assisted runs prove reliable.

Never invent an answer. When uncertain: do not submit, do not retry, do not guess — ask in chat and move on.

---

## 12. Retry policy

- Maximum **3 retries** after the original attempt.
- **Every retry requires explicit approval**, asked as a Google Chat card. No silent retry.
- Each retry must propose a specific change; never retry a validation failure unchanged.
- After retry 3 → `NEEDS_HUMAN_REVIEW` + notification. Counter resets only on explicit user action.

Failure classes: transient network · ATS server error · auth expired · browser/session failure · validation failure · missing information · CAPTCHA · adapter defect · posting closed · duplicate · unknown.

---

## 13. Evidence

Mandatory per submission: employer, title, requisition ID, ATS, canonical URL, timestamp, confirmation text if visible, **screenshot**.

Levels: **E0** none (unverified) · **E1** confirmation email · **E2** employer dashboard · **E3** captured success page · **E4** multiple independent confirmations.

Screenshot automatically on: successful submission, success/thank-you page, parked-for-human, blocking error. Store as files — never into LLM context unless debugging.

E1 is supplied by the inbox worker, so evidence levels rise on their own over the days after a submission.

No evidence → not a verified submission.

---

## 14. Inbox worker (daily mail check)

Runs once a day, before the main run. Read-only Gmail scan of the application email.

**Classifies each relevant message into:**

| Class | Effect |
|---|---|
| Application confirmation | Attach as E1 evidence, raise evidence level, `SUBMITTED_UNVERIFIED → SUBMITTED_VERIFIED` |
| Rejection | `→ REJECTED`, record date and reason if stated |
| Interview / screening invite | `→ INTERVIEW`, **high-priority notification** |
| Recruiter outreach | Store as an inbox item on the dashboard, no state change |
| Assessment / test link | `→ BLOCKED_HUMAN` + notification |
| Offer | `→ OFFER`, **high-priority notification** |
| Action required (docs, forms, scheduling) | Notification + dashboard flag |
| Job alert / newsletter | Hand to discovery as a source, not an update |
| Unrelated | Ignore |

**Matching:** message → application by requisition ID in the body, then ATS thread/message ID, then employer domain + recent submission window. If it can't be matched confidently, it lands on the dashboard as **unmatched** rather than being attached to the wrong job.

**Rules**
- Read-only. Never replies, never archives, never deletes.
- Stores only sender, subject, timestamp, classification, and the extracted fields — not full message bodies.
- Runs before discovery so the day's run knows which jobs are already closed out.

---

## 15. Adapter interface

```ts
interface JobAdapter {
  discover(): Promise<JobCard[]>
  inspect(job): Promise<ApplicationSchema>
  preflight(job): Promise<PreflightResult>
  apply(job, approvedAnswers): Promise<ApplicationResult>
  verifySubmission(job): Promise<Evidence[]>
  healthCheck(): Promise<AdapterHealth>
}
```

Health states: Healthy · Degraded · Broken · Auth Required · Human Intervention Required · Disabled. Tracked per adapter with last success, last error, 24h/7d success rate, affected jobs.

Adapter order (most deterministic first): **Greenhouse → Lever → Ashby → Workday → SmartRecruiters → Amazon → Microsoft → Naukri → LinkedIn → Indeed.** Do not start with LinkedIn or Workday.

New adapters run in shadow mode (no submission) before being enabled.

---

## 16. Token discipline

- Deterministic filters before any LLM call.
- Workers exchange compact structured contracts, never browser transcripts.
- Extract only headings, questions, labels, required fields, and validation messages from pages — not the DOM.
- Mail classification uses sender + subject + first N lines, not whole threads.
- Cache evaluation by `jd_hash + policy_version`; skip re-analysis when unchanged.
- Process deltas only.
- Cheap model for normalization, mail classification, and simple decisions; strong model only for ambiguity, conflicts, answers, and failure diagnosis.
- Per-worker input/output token caps with a summarization fallback.
- Log per call: worker, job, input/output tokens, cache hit, cost, purpose.

---

## 17. Reliability

- **Lock** per `application_key` — one worker per requisition.
- **Heartbeats** on long browser tasks; a dead worker marks the job interrupted, never submitted.
- **Crash recovery:** preserve state, capture the tab URL, check candidate dashboard and inbox to determine whether it actually submitted, resume only if safe.
- **Safe defaults:** when uncertain, park and ask rather than act.

---

## 18. Run policy

Local runs: **60-minute maximum**, wind-down at minute 55, finish early when the queue empties.

```yaml
run:
  max_duration_minutes: 60
  wind_down_start_minutes: 55
  stop_when_queue_empty: true
  priority_order: [A, B, C]
unfinished_work:
  preserve: true
  resume_next_run: true
```

At wind-down: no new lengthy applications; capture evidence; persist application and browser state; preserve pending chat questions, retries, and the queue. **A timeout parks work — it never discards it.**

Daily order: **inbox scan → adapter health check → discovery + applications (≤60 min) → evidence reconciliation.** Approvals are answered asynchronously in chat whenever you get to them.

Duration is configuration, not architecture — raise it only after reliability and cost are measured.

---

## 19. Dashboard (Next.js) — control and display

The dashboard exists to **run the system and show its state**. It answers no questions; that happens in chat.

**Control**
- Start / stop / pause a run
- Set mode: discovery-only · dry-run · assisted · approval-gated · autonomous
- Enable or disable adapters and sources
- Edit `personal.md` and policy files (explicit save; commits and bumps version)
- Resume a parked job, reset a retry counter, cancel an application

**Display**
- **Overview:** jobs discovered today · new eligible · A-tier · submitted · pending chat questions · **human action required** · retries waiting · adapters degraded · tokens and cost today
- **Jobs:** filterable list with tier, state, requisition, source, duplicate status
- **Applications pipeline:** Queued → Applying → Waiting Approval → Parked → Submitted → Interview → Rejected → Offer
- **Updates:** the inbox worker's feed — confirmations, rejections, interviews, recruiter mail, action-required items, and unmatched messages
- **Runs:** trigger time, phase, current worker, jobs processed, errors, tokens, where it stopped
- **Adapter health**
- **Evidence:** screenshots and confirmations per application
- **Approvals log:** read-only record of every chat card and its answer
- **Audit log:** actor · job · action · reason · policy version · approval ID · timestamp · result

---

## 20. Core database tables

No personal facts in any of these.

```
companies                 ats_tenants
job_postings              job_families           job_sources
job_evaluations
applications              application_events     application_answers
approvals                 approval_events        chat_messages
notifications
inbox_messages
evidence                  screenshots
adapters                  adapter_health_events
runs                      run_events
retry_attempts
resume_variants           resume_versions
model_calls               token_usage
audit_events
```

**applications** critical fields:
```
id · job_posting_id · canonical_employer_id · ats_tenant_id · requisition_id
application_key (unique on confirmed submission) · status · tier
resume_version_id · first_attempt_at · submitted_at · retry_count
evidence_level · last_inbox_update_at · created_at · updated_at
```

**approvals** critical fields:
```
id · application_id · type · status · question · field_key · context
proposed_answer · approved_answer · scope · chat_message_id
policy_file_updated · created_at · answered_at · expires_at
```

**inbox_messages** critical fields:
```
id · gmail_message_id · thread_id · from · subject · received_at
classification · matched_application_id (nullable) · match_confidence
extracted_fields (jsonb) · surfaced_at
```

---

## 21. Build order

```
1  Monorepo + Postgres schema
2  personal.md + policy .md loader, validator, Git write-back
3  Dashboard shell (Next.js): control panel, run status, file editors
4  Jobs + application history + requisition idempotency
5  Google Chat integration: approval cards, webhook reply handler, scopes
6  Notification channel (blocked / CAPTCHA / adapter down)
7  Greenhouse discovery → Lever discovery
8  Evaluator (hard gates + A/B/C/SKIP) + token tracking
9  Inbox worker: daily scan, classification, matching, Updates page
10 Adapter health
11 Playwright browser service
12 One ATS in dry-run, then assisted-apply
13 Screenshot evidence + email evidence reconciliation
14 Retry engine (chat-approved, max 3) + locks + crash recovery
15 Approval-gated submit
16 More adapters by actual yield
17 Scheduling + analytics
```

Development modes, in order: **Discovery only → Dry run → Assisted apply → Approval-gated submit → Policy-autonomous.**

---

## 22. Tests that must exist

**Idempotency**
```
same company + same req            → block
same company + different req       → allow
same title + different req         → allow
same JD + different req            → allow
same req via different source URLs → block
```

**Approvals**
- UNKNOWN never becomes NO
- No chat reply → job stays parked, never guessed
- Conflicting sources create a card
- No retry without an approved card; hard stop at 3
- Permanent answer updates `personal.md` / policy file and version
- `This job` answer does not leak to other jobs

**Inbox**
- Rejection mail moves the right application to REJECTED
- Confirmation mail raises evidence level to E1
- Unmatchable mail lands as unmatched, never attached to the wrong job

**Adapters:** parse saved sanitized fixtures with no live site.

---

## 23. v1 acceptance

1. Discovery from ≥3 sources, normalized to JobCards.
2. Exact duplicate requisitions blocked; same-title different-req still eligible.
3. A/B/C/SKIP evaluation works and is explainable.
4. All personal information lives in `personal.md`; the database contains none.
5. Unknown questions arrive as Google Chat cards and the reply drives the job, including permanent write-back.
6. CAPTCHA and other human-only blocks send a notification with a dashboard link.
7. One ATS runs dry-run, then assisted-apply end to end.
8. Every submission stores a screenshot and appears in the evidence view.
9. Daily mail scan runs and application statuses update from it; unmatched mail is visible.
10. Retry approval enforced, capped at 3.
11. Dashboard controls runs and modes and shows current stats and status.
12. Audit log explains every major action; token usage recorded.
13. No plaintext credentials anywhere — including chat messages.
14. 60-minute cap respected; unfinished work survives to the next run.

---

## 24. Operating rules

1. Automate execution, never invent intent.
2. Unknown is not No — and no reply is not an answer.
3. Personal information lives in `personal.md` and nowhere else.
4. Questions go to chat; state goes to the dashboard.
5. Different requisition IDs are different opportunities.
6. Similarity groups jobs; it never deduplicates them.
7. No submission without reliable job identity.
8. No retry without approval; maximum three.
9. No evidence, no verified submission.
10. Human verification gates stay human — notify, never attempt.
11. Hard gates and ranking signals stay separate.
12. Deterministic code before expensive reasoning.
13. Raw browser data and full mail bodies stay out of model context.
14. Credentials never appear in prompts, Git, logs, chat, or the dashboard.
15. Keep working other jobs while one waits for a reply.
16. The database is operational memory; LLM context is scratch.
17. A timeout parks work; it never discards it.

---

**Division of ownership:** Google Chat owns questions and alerts · the dashboard owns control and visibility · `personal.md` owns personal facts · policy files own the rules · Postgres owns operational state · Playwright owns browser execution · the LLM owns reasoning · **the user owns every undefined personal or career decision.**
