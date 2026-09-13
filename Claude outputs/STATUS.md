# JobOps v3 — Status

_Last updated: 11 September 2026_

This is the working status of the v3 rebuild: what is live, what is half-built,
and what comes next. The architecture itself is in `docs/V3-SparkFlow.md`; this
file is the progress ledger.

---

## 1. The shape of v3

Four phases, running on different clocks:

| # | Phase | Runs on | State |
|---|-------|---------|-------|
| 1 | **Discovery** — find jobs, write rows into the Sheet | Gemini Spark, every 4h + Apps Script board polling, hourly | Live (Spark) / just built (polling) |
| 2 | **Pipeline** — identify, dedupe, enrich, gate | Apps Script, hourly + manual | Live |
| 3 | **Dashboard** — view the funnel, trigger a tick | Next.js on Netlify | Built, deploy broken |
| 4 | **Applier** — actually submit applications | Playwright, manual trigger | **Not started** |

The Google Sheet is the single source of truth. Everything reads and writes it;
nothing holds state anywhere else.

---

## 2. Done

### Discovery — Spark
- One Spark schedule live: *"Find software engineering jobs"*, every 4 hours,
  writing directly into the **Jobs** tab.
- Confirmed working on the Gemini **Pro** tier (not Ultra-only, as first assumed).
- Caps at ~20 jobs per run and takes close to an hour per run.
- **Cannot be triggered programmatically.** Spark has no API. Nothing in this
  system can start it — not the dashboard button, not the hourly trigger.

### Discovery — board polling (new, 11 Sep)
- `v3/appsscript/Sources.gs` added: a fixed list of company boards polled straight
  from each ATS's own public JSON API.
- Covers **Greenhouse, Lever, Ashby, SmartRecruiters, Workday**. Workday needs a
  POST to the undocumented `/wday/cxs/<tenant>/<site>/jobs` endpoint; it earns the
  special case because Workday is ~63% of what Spark has been returning.
- New **Sources** tab: `ATS | Tenant | Site | Active | Last Poll | Last Count | Status | Notes`.
- `probeSources()` verifies every tenant and sets `Active=no` on any that 404,
  writing the reason into Status. This is the check v2 never had — seven of v2's
  twenty boards were dead slugs and it reported zero jobs as if that were a result.
- `pollSources(n)` walks the list 6 boards per run via a cursor in script
  properties, so it never hits the 6-minute execution cap.
- A pre-filter (`looksRelevant`) applies the Policies rows *before* writing, so a
  single Greenhouse board does not dump 800 US roles into the Sheet.

### Pipeline — Apps Script
- `normalizeRows()` — backfills Job ID / ATS / Discovered At for rows Spark wrote
  directly, and marks later copies of an ID as `Skipped` rather than deleting them.
- Requisition ID is parsed out of the apply-link URL, so identity survives even
  though the row arrived by scraping. Falls back to an MD5 of company|role|location.
- `enrichPending(40)` — pulls the real posting from the ATS JSON API.
- `applyGates()` — country, blocked title words, required title words, experience
  band, all read live from the **Policies** tab.
- `hourlyTick()` now runs `pollSources(6)` → normalize → enrich → gate, and stamps
  a heartbeat (`LAST_TICK`) carrying `boardsPolled` and `sourcedNew`.
- Web app: `doGet` serves the dashboard, `doPost` accepts `{action:'tick'}`,
  `{rows:[]}`, and `{jobId,status,notes}` — all token-guarded.

### Fixes landed along the way
- Blocked-word gate ignores parentheticals and matches whole words. Before this,
  *"Software Engineer (Secrets Manager & AI Identity)"* — match score 95 — was
  rejected for containing "manager".
- Country gate compares against a comma-separated list of cities, not the country
  name. Postings say "Bangalore", not "India".
- `getUi().alert()` replaced with `Logger.log()` — the dialog renders on the Sheet
  tab, not the script editor, so runs appeared to hang forever at "Execution started".

---

## 3. Current state of the data

As of the last check: **30 jobs** in the Sheet, all from Spark.

| Source | Count |
|---|---|
| Workday (19 different tenants) | 19 |
| Greenhouse | 3 |
| amazon.jobs | 3 |
| Company career sites (Adobe, Cisco, SAP, Bitwarden, Abnormal) | 5 |

No aggregators — Spark is going to employers' own career pages, which is the right
behaviour for applying directly.

**Target geography is India + global remote open to India.** Most of the current 30
are US enterprise roles and will not survive the country gate.

---

## 4. Open problems

### Netlify deploy is broken
The dashboard builds but does not serve. Sequence of causes found so far:

1. Original site was a **Netlify Drop** site — no build pipeline at all, so it
   uploaded raw repo files. Root has no `index.html` → 404 on every path.
2. Recreated as a Git-linked site. The Next.js runtime now loads, but the build
   fails: Netlify auto-detected a monorepo and set **Package directory** to
   `apps/dashboard` — the **v2** dashboard — and ran `npm run build` at the repo
   root, which has no `build` script.

**Fix in flight:** `netlify.toml` written at the repo root pinning
`base = "v3/dashboard"`. Still to do:
- [ ] `git add netlify.toml && git commit && git push`
- [ ] In Netlify → Build settings, **clear** Package directory, Base directory,
      Build command and Publish directory — the toml supplies all four
- [ ] Confirm the log shows `Config file: /opt/build/repo/netlify.toml` and
      `Current directory: /opt/build/repo/v3/dashboard`

A correct build takes 60–90s. Anything under 30s means it is not building.

### Enrichment covers almost nothing
`enrichPending()` only knows the Greenhouse, Lever and SmartRecruiters APIs — that
is **3 of 30 rows**. Every Workday tenant, Amazon, and all five career sites get no
JD text, so the experience gate has nothing to read and silently passes them.

The 0–3 year band is therefore effectively unenforced on ~90% of rows. In v2 this
same gate accounted for 65% of all rejections, so the real filtering has not started.

**Needed:** a Workday JD adapter. It alone covers 19 of 30.

### Job Match scores carry no signal
Every Spark score lands between 84 and 96. They cannot be used for ranking.

### No applier
Phase 4 does not exist. Status stays `Not Applied` for every row. Nothing in this
system has ever submitted an application.

---

## 5. Next

**Immediately**
1. Run `probeSources()` and fix the tenant slugs it marks DEAD. The seed list was
   written from memory and not one slug has been verified.
2. Run `pollSources(6)` and confirm real rows land in the Jobs tab.
3. Redeploy the web app — *Deploy → Manage deployments → edit → New version*.
   Skipping this is why the endpoint served stale code twice already.
4. Finish the Netlify fix (checklist above).

**Short**
5. Second Spark schedule, angled at Lever/Greenhouse/Ashby startups hiring in India
   or remote, so the two schedules do not collide. Roughly doubles recall for zero
   code; `normalizeRows()` already dedupes the overlap.
6. Workday JD adapter, so the experience gate fires on the majority of rows.
7. Grow the Sources list to 100–200 companies that actually hire in India.

**Then — Phase 4, the applier**
8. Playwright CLI with a persistent browser profile.
9. Per-ATS form adapters. Greenhouse, Lever and Ashby are broadly similar; Workday
   is its own project and needs an account per tenant.
10. Google SSO handling for boards that demand a login.
11. Write `Applied` + `Applied At` back through `doPost`.
12. Dry-run mode that fills every field and stops short of submit, so the first
    real applications can be eyeballed before anything is sent under Vinoth's name.

---

## 6. Housekeeping — do not forget

- [ ] **Revoke the exposed `ANTHROPIC_API_KEY`.** It was pasted in plain text.
- [ ] Delete the old OAuth client secret ending `4g3X`.
- [ ] Remove the temporary `debugError` block from `apps/api/src/routes/state.ts` (v2).
- [ ] Fix or delete the 7 dead Lever boards in v2's `data/boards.md`.
- [ ] Name the Apps Script project — it is still "Untitled project".

---

## 7. Things worth remembering about this system

- **Spark cannot be triggered.** Only Gemini starts it. The dashboard's
  "Run pipeline" button processes rows that are already in the Sheet.
- **Redeploy after every Apps Script edit.** The `/exec` URL serves the last
  deployed *version*, not the current editor contents.
- **The Sheet is the contract.** Column names in `JOB_HEADERS` are read by name,
  so renaming a column in the Sheet breaks the pipeline silently.
- **Nothing deletes rows.** Duplicates are marked `Skipped`. Deleting rows under a
  live agent that is still writing is asking for trouble.
