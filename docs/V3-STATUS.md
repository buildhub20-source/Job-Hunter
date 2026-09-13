# JobOps v3 — Status

_Last updated: 12 September 2026, 03:00 IST_

The progress ledger for the v3 rebuild. Architecture is in `docs/V3-SparkFlow.md`.

---

## 1. The shape of v3

| # | Phase | Runs on | State |
|---|-------|---------|-------|
| 1 | **Discovery** — find jobs, write rows into the Sheet | Gemini Spark every 4h + Apps Script board polling hourly | **Live** |
| 2 | **Pipeline** — identify, dedupe, enrich, gate | Apps Script, hourly + manual | **Live** |
| 3 | **Dashboard** — view the funnel, trigger a tick | Next.js on Netlify | **Live** |
| 4 | **Applier** — actually submit applications | Playwright, manual trigger | **Not started** |

The Google Sheet is the single source of truth. Everything reads and writes it.

**Target:** India-based roles plus remote roles open to India, 0–3 years, backend
(C#/.NET, Node, Java, Python, AWS, SQL).

**Live dashboard:** https://lambent-scone-b9805e.netlify.app/

---

## 2. Current numbers

```
TOTAL JOBS 43   ·   PASSED GATES 35   ·   NOT APPLIED 43   ·   APPLIED 0
```

Trimmed off by gates, with the reason recorded per row — the funnel is visible
end to end for the first time.

Sources of the 43: ~33 from Spark, ~11 from the board-polling layer.

---

## 3. Phases 1–3: done

### Discovery — Spark
- One schedule live, every 4 hours, writing straight into the **Jobs** tab.
- Runs on the Gemini **Pro** tier. ~20 jobs per run, close to an hour per run.
- **Cannot be triggered programmatically.** Spark has no API.
- Prompt rewritten to be explicit about India + remote, title variants, the 0–3
  band, brackets-are-not-seniority, full-range match scoring, and not padding the
  list to hit a row target.
- **Spark is outperforming the board layer on quality** — its rows are
  consistently `Software Engineer I`, `Associate Software Engineer`, `SDE-I` in
  Indian GCCs. Worth remembering when deciding where to invest next.

### Discovery — board polling (`v3/appsscript/Sources.gs`)
- Fixed list of company boards polled from each ATS's public JSON API:
  **Greenhouse, Lever, Ashby, SmartRecruiters, Workday**.
- **Sources** tab: `ATS | Tenant | Site | Active | Last Poll | Last Count | Status | Notes`.
- `probeSources()` — verifies every tenant, deactivates 404s with the reason.
- `pollSources(n)` — walks 6 boards per run via a cursor, never hits the
  6-minute execution cap.
- `debugBoard(ats, tenant)` — prints resolved policy values, posting count, first
  raw posting, kept count, titles dropped inside the target geography, and a
  location histogram. Every bug below was found with this.
- `findTenants(start, count)` — probes candidate slugs against all four ATSes and
  auto-appends any board with `kept > 0`.

### Pipeline — Apps Script (`v3/appsscript/Code.gs`)
- `normalizeRows()` — backfills Job ID / ATS / Discovered At for Spark's rows,
  marks later copies of an ID as `Skipped`.
- Requisition ID parsed from the apply-link URL; MD5 fallback.
- `enrichPending(40)` — pulls the posting from the ATS JSON API.
- `applyGates()` — country, blocked titles, required titles, experience band, all
  read live from the **Policies** tab.
- `hourlyTick()` — `pollSources(6)` → normalize → enrich → gate, with a heartbeat.
- Web app: `doGet` serves the dashboard; `doPost` accepts `{action:'tick'}`,
  `{rows:[]}`, `{jobId,status,notes}`. Token-guarded.

### Dashboard (`v3/dashboard`, Netlify)
- Stat tiles, gate-breakdown bars with percentages, filterable job table showing
  company, role, location, salary, ATS, match, gate verdict, status, apply link.
- "Run pipeline" button POSTs to `/api/tick`, which proxies to Apps Script with
  the token kept server-side.
- Deployed from GitHub with `netlify.toml` at the repo root pinning
  `base = "v3/dashboard"`.

---

## 4. Source discovery results

56 candidate employers probed across four ATSes. **12 boards added:**

| Employer | ATS | Postings | Kept |
|---|---|---|---|
| highradius | greenhouse | 83 | 11 |
| tekion | ashby | 110 | 8 |
| hackerrank | greenhouse | 29 | 7 |
| mindtickle | lever | 19 | 5 |
| swiggy | smartrecruiters | 75 | 4 |
| zeta | lever | 18 | 3 |
| meesho | lever | 49 | 3 |
| observeai | greenhouse | 16 | 3 |
| skyflow | ashby | 11 | 1 |
| atlan | ashby | 8 | 1 |
| unacademy | smartrecruiters | 3 | 1 |
| freshworks | smartrecruiters | 100 | 1 |

**No public board:** Razorpay, PhonePe, Flipkart, Zomato, Myntra, Juspay, Zerodha,
BrowserStack, CleverTap, Sprinklr, MoEngage, Darwinbox, Nutanix, Arcesium,
ThoughtSpot, Dream11, Games24x7, Jupiter, Setu, Signzy. They run their own portals
or use Darwinbox/Keka, which expose no API. **Reaching these needs the Playwright
scraper, not this layer.**

---

## 5. Bugs found and fixed

### Policy values read as objects, not strings
`readPolicies()` returns `{ country: { value, type } }`. `looksRelevant()` read
`pol.country` and called `.split(',')` on the object, silently falling back to a
two-word default.
**Symptom:** 2,238 Greenhouse postings seen, **zero kept**, across six boards.
**Fix:** `polVal()` helper accepting either shape.

### The `country` policy was a single word
Policies had `country = India`. Boards write the city alone — `"Bengaluru"` — so
27 of Stripe's 27 Bengaluru roles failed geography. Affected `applyGates()` too.
**Fix:** full city list.

### Blank location was a free pass, not a reject
Both `looksRelevant()` and `applyGates()` read `if (loc && …)`, meaning "only check
geography when we have a location" — which turned *unknown* into *approved*.
**Symptom:** two Accenture roles in **London and Newcastle** in an India-only sheet.
**Fix:** blank or `NA` location now rejects with `location missing — cannot verify
geography`.

### `blocked_title_words` missed abbreviations
`senior` does not match `Sr.`. Three Databricks senior roles passed.
**Fix:** added `sr, snr, specialist, consultant, iii, iv`.

### `required_title_words` too loose, then too tight
First version (`engineer,developer,sde,programmer`) admitted Customer Success
Engineer, Technical Support Engineer, Test Engineer, SIEM Engineer. Tightened
version then rejected **Amazon's `Software Development Engineer I`** — the single
most common junior title in Indian tech — plus `AI Developer` and
`Engineer - Target India`.
**Fix:** list now covers `software development engineer`, bare `developer`, and
language-specific forms.

### `ii` was over-blocking
`Software Engineer II` is typically 2–4 years — inside the band. Blocking it cost
5 rows including the highest-scoring job in the sheet (Hach, match 97).
**Fix:** `ii` removed; `iii` and `iv` kept.

### Correction to an earlier claim in this file
An earlier version said most Spark rows were US roles that would fail the country
gate. **That was wrong.** All are India GCC roles. Geography had been inferred from
Workday tenant domains rather than read from the Location column.

### Netlify — four separate causes, in sequence
1. Original site was a **Netlify Drop** site — no build pipeline, uploaded raw repo
   files, root had no `index.html` → 404 on every path.
2. Recreated as Git-linked; Netlify auto-detected a monorepo and set **Package
   directory** to `apps/dashboard` — the **v2** dashboard.
3. Ran `npm run build` at the repo root, which has no `build` script.
4. `netlify.toml` at the repo root with `base = "v3/dashboard"`, plus clearing all
   four UI build fields, fixed it.

**Diagnostic that worked:** build duration. A real Next.js build takes 60–90s.
The failing deploys finished in 7–18s, which is the tell that nothing was built.

### Earlier fixes still standing
- Blocked-word gate ignores parentheticals and matches whole words, so
  *"Software Engineer (Secrets Manager & AI Identity)"* passes.
- `getUi().alert()` replaced with `Logger.log()` — the dialog renders on the Sheet
  tab, not the editor, so runs appeared to hang at "Execution started".

---

## 6. Open problems

### The experience gate has never fired
Every rejection so far is title or location. **Not one is on years of experience.**
`enrichPending()` reports `0 enriched`, and every Salary reads `NA`.

Cause: enrichment only knows Greenhouse, Lever and SmartRecruiters. Workday,
Amazon and direct career sites — the majority of rows — get no JD text, so the
0–3 year rule has nothing to read and passes them silently.

Walmart's "2–5 years" role was caught by `iii` in its title, not by the experience
rule. In v2 this gate produced 65% of all rejections.

**Needed: a Workday JD adapter.** Highest-value remaining pipeline work.

### No applier
Phase 4 does not exist. 35 eligible jobs sit at `Not Applied`. Nothing in this
system has ever submitted an application. This is the original goal of the rewrite.

### Job Match scores may still be flat
Historically all scores landed 84–96, unusable for ranking. The rewritten Spark
prompt asks for the full range; not yet verified against a fresh run.

### Salary is NA on every row
No source is populating it. Lever exposes `salaryRange`; Greenhouse and Workday
mostly do not. Low priority but worth knowing the column is currently decorative.

---

## 7. Next

**Short**
1. **Workday JD adapter** — so the experience gate starts firing. ~60% of rows.
2. Second Spark schedule aimed at Lever/Greenhouse/Ashby startups, so the two
   schedules do not return the same companies.
3. Fix dead slugs: `doordash`, `sentry`, `Visa`, `Bosch` (the last two return 0
   postings rather than 404 — wrong SmartRecruiters company name).
4. Extend `CANDIDATE_TENANTS` and re-run `findTenants`. Hit rate was ~21%, so a
   longer candidate list is the cheapest way to grow coverage.

**Then — Phase 4, the applier**
5. Playwright CLI with a persistent browser profile.
6. Per-ATS form adapters. Greenhouse, Lever and Ashby share a similar shape and
   together cover Unacademy, Tekion, Mindtickle, Meesho, HighRadius. Workday is
   its own project and needs an account per tenant.
7. Google SSO for boards that demand a login.
8. Write `Applied` + `Applied At` back through `doPost`.
9. **Dry-run mode first** — fill every field, screenshot the completed form, stop
   short of submit. The first real applications get eyeballed before anything goes
   out under Vinoth's name.
10. The scraper also unlocks the employers with no public API (section 4).

**Constraint worth planning around:** the applier runs locally. The workspace that
gives Claude a shell on this machine is currently down from a Windows update, so
Claude can write the code but cannot run or debug it live the way it has with
Apps Script.

---

## 8. Housekeeping

- [ ] **Revoke the exposed `ANTHROPIC_API_KEY`** — pasted in plain text, still valid.
- [ ] Delete the old OAuth client secret ending `4g3X`.
- [ ] Remove the temporary `debugError` block from `apps/api/src/routes/state.ts` (v2).
- [ ] Fix or delete the 7 dead Lever boards in v2's `data/boards.md`.
- [ ] Name the Apps Script project — still "Untitled project".
- [ ] Delete the abandoned Netlify site `jolly-naiad-8145a4` to avoid confusion.

---

## 9. Things worth remembering about this system

- **Spark cannot be triggered.** Only Gemini starts it. The dashboard's
  "Run pipeline" button processes rows already in the Sheet.
- **Redeploy after every Apps Script code edit.** The `/exec` URL serves the last
  deployed *version*, not the editor contents. This has bitten twice.
- **Policy changes need no redeploy.** They are Sheet data, read at run time.
- **A board that is live is not a board that is useful.** Stripe has 627 postings,
  39 in India, 2 that match — the India office is finance and operations. Judge a
  source by `kept`, never by `total`.
- **Every filter needs a diagnostic that explains a zero.** `debugBoard` turned
  three separate guesses into three confirmed bugs in under an hour. Without it,
  "0 kept" and "no such jobs exist" look identical.
- **Missing data is not passing data.** Two gates treated an empty field as
  permission to skip the check. Both let wrong rows through.
- **The Sheet is the contract.** Column names in `JOB_HEADERS` are read by name,
  so renaming a column breaks the pipeline silently.
- **Nothing deletes rows.** Duplicates are marked `Skipped`.
