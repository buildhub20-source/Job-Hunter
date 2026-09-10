# Decisions

Why things are the way they are, so they don't get relitigated. Newest last.

### D1 — The subject is Vinoth, not Prasath
The agent runs **Vinoth M's** job search. `data/personal.md` describes him, applications
go out under his name, email and phone, and the inbox worker must scan **his** mailbox
(`gopir525@gmail.com`). Vinoth has agreed to this and will answer his own approval cards.
Aptean is excluded from targeting — both of them work there.

### D2 — Personal data in markdown, never in the database
`personal.md` and the policy files are the only home for human-authored facts. Postgres
holds only what the system generates. Rule: if a human writes it, it's markdown and
versioned in Git; if the system generates it, it's Postgres.

### D3 — PostgreSQL, after considering Excel and SQLite
Excel was rejected because it coerces requisition IDs (leading zeros vanish, `2024-08-15`
becomes a date), locks while open, rewrites the whole workbook per append, and cannot
enforce uniqueness. Those four properties are exactly what the duplicate rule depends on.
SQLite would have worked; Postgres was chosen deliberately.

### D4 — npm workspaces, not pnpm
pnpm isn't installed on the target machine. npm workspaces need no extra install step.

### D5 — Approvals in Google Chat; dashboard for control and display only
Questions go to a Chat space as interactive cards. The dashboard runs the system and
shows state; its Approvals page is a read-only log. Unspecified or forged scope falls
back to `this_job`, never `permanent`.

### D6 — The Chat webhook is authenticated, and fails closed
It can answer approvals on Vinoth's behalf, so it verifies Google's RS256 bearer token
against Google's certs, or a shared secret locally. With neither configured it refuses
every request rather than running open.

### D7 — Autonomous submission, with a recommendation attached
Prasath asked for the agent to submit by itself and involve a human only when stuck.
Recorded, and it's a config flag. The standing recommendation is to run the **first ten
assisted** anyway: live submissions are where form-mapping bugs surface, and a bad
submission can't be recalled — it reaches a real employer under Vinoth's name.

### D8 — `requires_sponsorship_us` stays UNKNOWN
Answering "No" would raise shortlist rates, which is exactly what makes it a material
misrepresentation for an Indian citizen without US status. It surfaces at I-9 and
background check, after an offer, and the consequences land on Vinoth. Left unknown; the
geo policy (India plus remote roles hiring India-based candidates) means the question
essentially never fires. If it does, Vinoth answers it himself in Chat.

### D9 — Expected CTC raised 600000 to 800000
Current 5L, ask 8L, walk-away floor 6L. Previously the ask and the floor were both 6L,
leaving no negotiating room while under-pricing a profile with production RAG and
multi-agent work at 2.2 years.

### D10 — Resumes: base plus per-employer override
Vinoth tailors per company rather than keeping fixed variants, so the selector uses
`data/resumes/<employer_id>.pdf` when one exists and falls back to the default
(`amazon.pdf`). The selector chooses a file; it never edits a resume.

### D11 — Lever postings carry no requisition ID
`requisitionId` stays `null` and identity falls back to the posting UUID, which is
stable. Inventing a requisition ID there would silently break the duplicate rule.

### D12 — Build on the work laptop, run on a personal machine
The repo lives on an Aptean-managed machine. Writing code there is ordinary developer
activity; signing into Vinoth's Gmail, driving browsers into job portals and submitting
live applications is not. Two Aptean employees are involved, so operation moves to
personal hardware.

### D13 — The GitHub remote is public, on purpose
Pushed to `github.com/buildhub20-source/Job-Hunter` 2026-09-10. Set private first, since
`data/personal.md` (Vinoth's DOB, phone, salary, citizenship) is in the committed
history and a public repo exposes all of it, not just the current file. Prasath then
switched it to public and, after being told explicitly what that exposes, confirmed it
as intentional. Left as public; not something to "fix" back to private on a future pass
unless he says otherwise.
