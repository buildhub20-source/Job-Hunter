/**
 * JobOps v3 — Sheet pipeline
 * See docs/V3-SparkFlow.md. Spark writes rows; this script gives them identity,
 * enriches them from the ATS's own API, runs the gates, and serves the dashboard.
 *
 * First run:
 *   1. setupSheet()      — creates the Jobs and Policies tabs
 *   2. setupResumes()    — creates the Resumes tab (see Resumes.gs)
 *   3. installTriggers() — hourly + onChange
 *   4. Deploy > New deployment > Web app (Execute as me, Anyone with the link)
 *      then read the token with showToken()
 */

const JOBS_SHEET = 'Jobs';
const POLICIES_SHEET = 'Policies';

const JOB_HEADERS = [
  'Job ID', 'Company Name', 'Role', 'Location', 'Salary', 'Apply Link', 'ATS',
  'Job Match', 'Gate Result', 'Status', 'Applied At', 'Notes', 'JD Text', 'Discovered At',
  'Resume', 'Resume Match',
];

const SEED_POLICIES = [
  ['key', 'value', 'type', 'active', 'notes'],
  ['experience_max_years', '3', 'hard_gate', 'yes', 'reject if the JD floor exceeds this'],
  ['blocked_title_words', 'senior,staff,principal,manager,director,lead,architect', 'hard_gate', 'yes', ''],
  ['required_title_words', 'engineer,developer,sde,programmer', 'hard_gate', 'yes', 'catches IT-support / service-desk false positives'],
  ['country', 'india,bengaluru,bangalore,chennai,coimbatore,hyderabad,pune,mumbai,delhi,noida,gurgaon,remote', 'hard_gate', 'yes', 'passes if the location matches any of these'],
  ['preferred_stack', '.net,asp.net,node,react,aws,microservices', 'ranking', 'yes', 'not a gate — scoring only'],
];

/* ------------------------------------------------------------------ setup */

function setupSheet() {
  const ss = SpreadsheetApp.getActive();

  let jobs = ss.getSheetByName(JOBS_SHEET) || ss.insertSheet(JOBS_SHEET);
  if (jobs.getLastRow() === 0) {
    jobs.getRange(1, 1, 1, JOB_HEADERS.length).setValues([JOB_HEADERS]).setFontWeight('bold');
    jobs.setFrozenRows(1);
  }
  ensureJobColumns();
  // Markdown and URLs must never be parsed as formulas.
  jobs.getRange(1, 1, jobs.getMaxRows(), JOB_HEADERS.length).setNumberFormat('@');

  let pol = ss.getSheetByName(POLICIES_SHEET);
  if (!pol) {
    pol = ss.insertSheet(POLICIES_SHEET);
    pol.getRange(1, 1, SEED_POLICIES.length, 5).setValues(SEED_POLICIES);
    pol.getRange(1, 1, 1, 5).setFontWeight('bold');
    pol.setFrozenRows(1);
  }

  if (!PropertiesService.getScriptProperties().getProperty('API_TOKEN')) {
    PropertiesService.getScriptProperties()
      .setProperty('API_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  }
  Logger.log('Setup complete. Run installTriggers() next.');
}

function showToken() {
  Logger.log('API token: ' + PropertiesService.getScriptProperties().getProperty('API_TOKEN'));
}

function installTriggers() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('hourlyTick').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  Logger.log('Triggers installed: hourly + onChange.');
}

/**
 * Add any JOB_HEADERS column the sheet doesn't have yet, at the right-hand end. Sheets
 * made before a column existed keep their data where it is; everything else finds
 * columns by header name.
 */
function ensureJobColumns() {
  const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
  if (!sh || sh.getLastRow() === 0) return;
  const have = headerIndex(sh);
  const missing = JOB_HEADERS.filter(h => !(h in have));
  if (!missing.length) return;
  const col = sh.getLastColumn() + 1;
  const needed = col + missing.length - 1 - sh.getMaxColumns();
  if (needed > 0) sh.insertColumnsAfter(sh.getMaxColumns(), needed);
  sh.getRange(1, col, 1, missing.length).setValues([missing]).setFontWeight('bold');
  Logger.log('ensureJobColumns: added ' + missing.join(', '));
}

/* --------------------------------------------------------------- identity */

/**
 * Stable key from the apply link. Every major ATS puts the requisition id in the
 * URL, so identity survives even though the row came from scraping.
 * Falls back to a hash of company|role|location when no id is present.
 */
function jobId(applyLink, company, role, location) {
  const url = String(applyLink || '').split(/[?#]/)[0].replace(/\/+$/, '');
  const pats = [
    [/greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i,              'greenhouse'],
    [/lever\.co\/([^/]+)\/([0-9a-f-]{16,})/i,              'lever'],
    [/ashbyhq\.com\/([^/]+)\/([0-9a-f-]{16,})/i,           'ashby'],
    [/smartrecruiters\.com\/([^/]+)\/(\d+)/i,              'smartrecruiters'],
    [/([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com\/.*?([A-Z]{2,4}-?\d{4,})/i, 'workday'],
  ];
  for (const [re, ats] of pats) {
    const m = url.match(re);
    if (m) return { id: ats + ':' + String(m[2]).toLowerCase(), ats: ats, tenant: m[1] };
  }
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const key = [norm(company), norm(role), norm(location)].join('|');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key);
  const hash = bytes.map(b => (b & 0xff).toString(16).padStart(2, '0')).join('').slice(0, 12);
  return { id: 'hash:' + hash, ats: 'other', tenant: '' };
}

/* ----------------------------------------------------------------- append */

function headerIndex(sheet) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const ix = {};
  head.forEach((h, i) => { ix[String(h).trim()] = i; });
  return ix;
}

/**
 * Append only genuinely new jobs. Dedupes against the sheet AND within the batch,
 * because a single Spark run will hand you the same job more than once.
 * A row that is already Applied is never touched.
 */
function appendNewJobs(rows) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
    const ix = headerIndex(sh);
    const last = sh.getLastRow();
    const existing = last > 1
      ? sh.getRange(2, ix['Job ID'] + 1, last - 1, 1).getValues().map(r => r[0])
      : [];
    const seen = new Set(existing.filter(String));

    const fresh = [];
    for (const r of rows) {
      const { id, ats } = jobId(r.applyLink, r.company, r.role, r.location);
      if (seen.has(id)) continue;
      seen.add(id);
      const row = new Array(JOB_HEADERS.length).fill('');
      row[ix['Job ID']]       = id;
      row[ix['Company Name']] = r.company || '';
      row[ix['Role']]         = r.role || '';
      row[ix['Location']]     = r.location || 'NA';
      row[ix['Salary']]       = r.salary || 'NA';
      row[ix['Apply Link']]   = r.applyLink || '';
      row[ix['ATS']]          = ats;
      row[ix['Job Match']]    = r.match || '';
      row[ix['Gate Result']]  = '';
      row[ix['Status']]       = 'Not Applied';
      row[ix['Discovered At']] = new Date().toISOString();
      fresh.push(row);
    }
    if (fresh.length) {
      sh.getRange(last + 1, 1, fresh.length, JOB_HEADERS.length).setValues(fresh);
    }
    return fresh.length;
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------- enrichment */

/* -------------------------------------------------------------- JD lookup */

/**
 * Workday exposes the full posting at an undocumented "cxs" endpoint that mirrors
 * the public URL. Two URL shapes exist in the wild:
 *
 *   https://danaher.wd1.myworkdayjobs.com/en-US/danaherjobs/job/Bangalore/Software-Engineer_R123
 *   -> https://danaher.wd1.myworkdayjobs.com/wday/cxs/danaher/danaherjobs/job/Bangalore/Software-Engineer_R123
 *
 *   https://wd1.myworkdaysite.com/recruiting/wf/WellsFargoJobs/job/Hyderabad/SE_R456
 *   -> https://wd1.myworkdaysite.com/wday/cxs/wf/WellsFargoJobs/job/Hyderabad/SE_R456
 *
 * The tenant is the host's first label in the first shape, and the first path
 * segment after /recruiting in the second.
 */
function workdayJdUrl(applyLink) {
  const m = String(applyLink || '').match(/^https?:\/\/([^\/]+)(\/[^?#]*)/);
  if (!m) return null;
  const host = m[1];
  if (host.indexOf('myworkdayjobs.com') < 0 && host.indexOf('myworkdaysite.com') < 0) return null;

  const segs = m[2].split('/').filter(String);
  if (segs.length && /^[a-z]{2}-[A-Za-z]{2}$/.test(segs[0])) segs.shift();   // locale

  let tenant, site;
  if (/^wd\d+$/i.test(host.split('.')[0])) {
    if (segs[0] === 'recruiting') segs.shift();
    tenant = segs.shift();
    site   = segs.shift();
  } else {
    tenant = host.split('.')[0];
    site   = segs.shift();
  }
  const rest = segs.join('/');
  if (!tenant || !site || !rest) return null;
  return 'https://' + host + '/wday/cxs/' + tenant + '/' + site + '/' + rest;
}

/** Amazon publishes every posting as JSON by appending .json to the job URL. */
function amazonJdUrl(applyLink) {
  const m = String(applyLink || '').match(/amazon\.jobs\/(?:[a-z_-]+\/)?jobs\/(\d+)/i);
  return m ? 'https://www.amazon.jobs/en/jobs/' + m[1] + '.json' : null;
}

function jdGet(url) {
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true, followRedirects: true,
    headers: { 'Accept': 'application/json' },
  });
  if (res.getResponseCode() !== 200) return null;
  try { return JSON.parse(res.getContentText()); } catch (e) { return null; }
}

/**
 * Resolve a posting to { jd, location, salary, via } from its apply link alone.
 * Working from the URL rather than from the parsed Job ID matters: most Workday
 * rows fall back to a content hash, so anything keyed on the requisition id
 * skipped them — which is why the experience gate never fired.
 *
 * `tenantHint` is the Company Name, used only when the URL carries a Greenhouse
 * job id but not the board it belongs to (e.g. stripe.com/jobs/search?gh_jid=…).
 */
function fetchJdByUrl(applyLink, tenantHint) {
  const url = String(applyLink || '');
  if (!url) return null;
  const bare = url.split(/[?#]/)[0];
  let j, m;

  // ---- Workday -------------------------------------------------------------
  const wd = workdayJdUrl(url);
  if (wd) {
    j = jdGet(wd);
    const info = j && (j.jobPostingInfo || j.jobPosting);
    if (!info) return null;
    return {
      jd: stripHtml(info.jobDescription || info.jobDescriptionText || ''),
      location: info.location || info.jobPostingLocation || '',
      salary: 'NA',
      via: 'workday',
    };
  }

  // ---- Amazon --------------------------------------------------------------
  const az = amazonJdUrl(url);
  if (az) {
    j = jdGet(az);
    const job = j && (j.job || j);
    if (!job) return null;
    const parts = [job.description, job.basic_qualifications, job.preferred_qualifications]
      .filter(String).join(' ');
    return { jd: stripHtml(parts), location: job.location || job.city || '', salary: 'NA', via: 'amazon' };
  }

  // ---- Greenhouse ----------------------------------------------------------
  m = bare.match(/greenhouse\.io\/([^\/]+)\/jobs\/(\d+)/i);
  const gh = url.match(/[?&]gh_jid=(\d+)/i);
  if (m || gh) {
    const tenant = m ? m[1] : String(tenantHint || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const id     = m ? m[2] : gh[1];
    if (!tenant) return null;
    j = jdGet('https://boards-api.greenhouse.io/v1/boards/' + tenant + '/jobs/' + id);
    if (!j) return null;
    return { jd: stripHtml(j.content || ''),
             location: (j.location && j.location.name) || '', salary: 'NA', via: 'greenhouse' };
  }

  // ---- Lever ---------------------------------------------------------------
  m = bare.match(/lever\.co\/([^\/]+)\/([0-9a-f-]{16,})/i);
  if (m) {
    j = jdGet('https://api.lever.co/v0/postings/' + m[1] + '/' + m[2]);
    if (!j) return null;
    return { jd: stripHtml(j.descriptionPlain || j.description || ''),
             location: (j.categories && j.categories.location) || '',
             salary: (j.salaryRange && j.salaryRange.min) ? String(j.salaryRange.min) : 'NA',
             via: 'lever' };
  }

  // ---- Ashby ---------------------------------------------------------------
  // No single-posting endpoint, so read the board and pick the id out of it.
  m = bare.match(/ashbyhq\.com\/([^\/]+)\/([0-9a-f-]{16,})/i);
  if (m) {
    j = jdGet('https://api.ashbyhq.com/posting-api/job-board/' + m[1] + '?includeCompensation=true');
    const hit = j && (j.jobs || []).filter(x => String(x.id) === m[2])[0];
    if (!hit) return null;
    return { jd: stripHtml(hit.descriptionPlain || hit.descriptionHtml || ''),
             location: hit.location || '', salary: 'NA', via: 'ashby' };
  }

  // ---- SmartRecruiters -----------------------------------------------------
  m = bare.match(/smartrecruiters\.com\/([^\/]+)\/(\d+)/i);
  if (m) {
    j = jdGet('https://api.smartrecruiters.com/v1/companies/' + m[1] + '/postings/' + m[2]);
    if (!j) return null;
    const ad = j.jobAd && j.jobAd.sections ? j.jobAd.sections : {};
    const parts = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map(k => (ad[k] && ad[k].text) || '').filter(String).join(' ');
    return { jd: stripHtml(parts || JSON.stringify(j.jobAd || '')),
             location: j.location ? [j.location.city, j.location.country].filter(String).join(', ') : '',
             salary: 'NA', via: 'smartrecruiters' };
  }

  return null;
}

function stripHtml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
}

/** Enrich rows that have no JD Text yet. Capped per run to stay inside quota. */
function enrichPending(limit) {
  const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
  const ix = headerIndex(sh);
  const last = sh.getLastRow();
  if (last < 2) return 0;

  const data = sh.getRange(2, 1, last - 1, JOB_HEADERS.length).getValues();
  const started = Date.now();
  let done = 0, missed = 0;

  for (let i = 0; i < data.length && done < (limit || 40); i++) {
    if (Date.now() - started > 240000) { Logger.log('enrichPending: time budget reached'); break; }
    const row = data[i];
    if (row[ix['JD Text']]) continue;
    if (row[ix['Status']] === 'Skipped') continue;

    let got = null;
    try {
      got = fetchJdByUrl(row[ix['Apply Link']], row[ix['Company Name']]);
    } catch (e) { got = null; }

    if (!got || !got.jd) { missed++; continue; }

    sh.getRange(i + 2, ix['JD Text'] + 1).setValue(got.jd);
    if (got.location) sh.getRange(i + 2, ix['Location'] + 1).setValue(got.location);
    if (got.salary && got.salary !== 'NA') sh.getRange(i + 2, ix['Salary'] + 1).setValue(got.salary);
    done++;
  }
  Logger.log('enrichPending: ' + done + ' enriched, ' + missed + ' could not be resolved');
  return done;
}

/**
 * Diagnostic. Prints what one apply link resolves to, so a failure to enrich can
 * be read rather than guessed at.  debugJd('https://…')
 */
function debugJd(applyLink, tenantHint) {
  Logger.log('link        = ' + applyLink);
  Logger.log('workday url = ' + (workdayJdUrl(applyLink) || '(not workday)'));
  Logger.log('amazon url  = ' + (amazonJdUrl(applyLink) || '(not amazon)'));
  let got = null;
  try { got = fetchJdByUrl(applyLink, tenantHint); } catch (e) { Logger.log('THREW: ' + e); return; }
  if (!got) { Logger.log('RESULT      = null — no adapter matched, or the fetch failed'); return; }
  Logger.log('via         = ' + got.via);
  Logger.log('location    = ' + got.location);
  Logger.log('jd length   = ' + got.jd.length);
  Logger.log('experience floor found = ' + jdExperienceFloor(got.jd));
  Logger.log('jd preview  = ' + got.jd.slice(0, 400));
}

/* ------------------------------------------------------------------ gates */

function readPolicies() {
  const sh = SpreadsheetApp.getActive().getSheetByName(POLICIES_SHEET);
  const vals = sh.getDataRange().getValues().slice(1);
  const out = {};
  vals.forEach(r => {
    const [key, value, type, active] = r;
    if (!key || String(active).toLowerCase() !== 'yes') return;
    out[String(key).trim()] = { value: String(value).trim(), type: String(type).trim() };
  });
  return out;
}

/** Lowest years-of-experience figure the JD asks for, or null if it asks for none. */
function jdExperienceFloor(text) {
  const t = String(text).toLowerCase();
  const floors = [];
  let m;
  const re = /(\d{1,2})\s*(?:\+|to\s*\d{1,2}|-\s*\d{1,2})?\s*(?:\+)?\s*years?/g;
  while ((m = re.exec(t)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 0 && n <= 25) floors.push(n);
  }
  return floors.length ? Math.min.apply(null, floors) : null;
}

/** Write Pass, or the reason the row was rejected, into Gate Result. */
function applyGates() {
  const pol = readPolicies();
  const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
  const ix = headerIndex(sh);
  const last = sh.getLastRow();
  if (last < 2) return 0;

  const data = sh.getRange(2, 1, last - 1, JOB_HEADERS.length).getValues();
  const results = [];
  for (const row of data) {
    // Never re-gate something already acted on.
    if (row[ix['Status']] === 'Applied') { results.push([row[ix['Gate Result']]]); continue; }

    const title = String(row[ix['Role']] || '').toLowerCase();
    const loc = String(row[ix['Location']] || '').toLowerCase();
    const jd = String(row[ix['JD Text']] || '');
    let verdict = 'Pass';

    if (verdict === 'Pass' && pol['blocked_title_words']) {
      // Seniority lives in the main title, never in a parenthetical. Without this,
      // "Software Engineer (Secrets Manager & AI Identity)" is rejected for "manager"
      // — a product name, not a level. Whole-word match too, so "lead" misses "leading".
      const mainTitle = title.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
                             .replace(/\s+/g, ' ').trim();
      const bad = pol['blocked_title_words'].value.split(',').map(s => s.trim()).filter(Boolean)
        .find(w => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(mainTitle));
      if (bad) verdict = 'title contains blocked word "' + bad + '"';
    }
    if (verdict === 'Pass' && pol['required_title_words']) {
      const words = pol['required_title_words'].value.split(',').map(s => s.trim()).filter(Boolean);
      if (words.length && !words.some(w => title.indexOf(w) !== -1)) {
        verdict = 'title is not an engineering role';
      }
    }
    if (verdict === 'Pass' && pol['country']) {
      // Comma-separated list: a location passes if it matches ANY entry. Postings
      // usually say "Bangalore", not "India", so the country name alone is not enough.
      // A blank location is a REJECT, not a free pass — skipping the check when the
      // string was empty let two Accenture roles in London and Newcastle through.
      const accepted = pol['country'].value.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (!loc || String(loc).trim() === 'na') {
        verdict = 'location missing — cannot verify geography';
      } else if (accepted.length && !accepted.some(c => loc.indexOf(c) !== -1)) {
        verdict = 'location [' + row[ix['Location']] + '] outside target geography';
      }
    }
    if (verdict === 'Pass' && pol['experience_max_years'] && jd) {
      const max = parseInt(pol['experience_max_years'].value, 10);
      const floor = jdExperienceFloor(jd);
      if (floor !== null && floor > max) {
        verdict = 'requires ' + floor + '+ years, above the ' + max + '-year limit';
      }
    }
    results.push([verdict]);
  }
  sh.getRange(2, ix['Gate Result'] + 1, results.length, 1).setValues(results);
  return results.length;
}


/* ------------------------------------------------------------ normalise */

/**
 * Spark writes rows straight into the sheet, bypassing appendNewJobs(), so nothing
 * has given those rows an identity. This backfills Job ID and ATS for any row that
 * lacks them, and marks later copies of an id as Skipped rather than deleting them
 * (deleting rows under a live agent that is still writing is asking for trouble).
 */
function normalizeRows() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
    const ix = headerIndex(sh);
    const last = sh.getLastRow();
    if (last < 2) return 0;

    const n = last - 1;
    const data = sh.getRange(2, 1, n, JOB_HEADERS.length).getValues();
    const ids = [], atss = [], statuses = [], notes = [], discovered = [];
    const seen = new Set();
    const nowIso = new Date().toISOString();
    let filled = 0, dupes = 0;

    for (const row of data) {
      const link = row[ix['Apply Link']];
      let id = row[ix['Job ID']];
      let ats = row[ix['ATS']];
      let status = row[ix['Status']] || 'Not Applied';
      let note = row[ix['Notes']] || '';

      if (link && !id) {
        const parsed = jobId(link, row[ix['Company Name']], row[ix['Role']], row[ix['Location']]);
        id = parsed.id; ats = parsed.ats; filled++;
      }
      if (id) {
        if (seen.has(id) && status !== 'Applied') {
          status = 'Skipped';
          note = note || 'duplicate of an earlier row';
          dupes++;
        } else {
          seen.add(id);
        }
      }
      ids.push([id]); atss.push([ats]); statuses.push([status]); notes.push([note]);
      // Spark does not stamp this; first time we see a row, record when it appeared.
      discovered.push([row[ix['Discovered At']] || nowIso]);
    }

    sh.getRange(2, ix['Job ID'] + 1, n, 1).setValues(ids);
    sh.getRange(2, ix['ATS'] + 1, n, 1).setValues(atss);
    sh.getRange(2, ix['Status'] + 1, n, 1).setValues(statuses);
    sh.getRange(2, ix['Notes'] + 1, n, 1).setValues(notes);
    sh.getRange(2, ix['Discovered At'] + 1, n, 1).setValues(discovered);
    Logger.log('normalizeRows: ' + filled + ' identified, ' + dupes + ' duplicates skipped');
    return filled;
  } finally {
    lock.releaseLock();
  }
}

/* --------------------------------------------------------------- triggers */

/**
 * The scheduled run. Stamps a heartbeat so you can prove from the outside that the
 * hourly trigger is actually firing — doGet returns it as lastTickAt.
 */
function hourlyTick() {
  // Poll a slice of the fixed board list first, so the rest of the tick sees
  // those rows in the same run. Spark's rows are already in the sheet.
  let sourced = { polled: 0, added: 0 };
  try { sourced = pollSources(6); } catch (e) { Logger.log('pollSources failed: ' + e); }

  const identified = normalizeRows();
  const enriched = enrichPending(40);
  const gated = applyGates();
  let resumesMatched = 0;
  try { resumesMatched = matchResumes(); } catch (e) { Logger.log('matchResumes failed: ' + e); }
  PropertiesService.getScriptProperties().setProperty('LAST_TICK', JSON.stringify({
    at: new Date().toISOString(),
    boardsPolled: sourced.polled || 0,
    sourcedNew: sourced.added || 0,
    identified: identified, enriched: enriched, gated: gated, resumesMatched: resumesMatched,
  }));
  Logger.log('hourlyTick: boards=' + (sourced.polled || 0) + ' sourced=' + (sourced.added || 0) +
             ' identified=' + identified + ' enriched=' + enriched + ' gated=' + gated +
             ' resumes=' + resumesMatched);
}

function onSheetChange(e) {
  if (!e || (e.changeType !== 'INSERT_ROW' && e.changeType !== 'EDIT')) return;
  normalizeRows();
  applyGates();
  try { matchResumes(); } catch (err) { Logger.log('matchResumes failed: ' + err); }
}

/* --------------------------------------------------------------- web API */

/** Dashboard data source. ?token=…  optional &status=Not%20Applied */
function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!e || !e.parameter || e.parameter.token !== token) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
  const last = sh.getLastRow();
  const ix = headerIndex(sh);
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues() : [];

  // By header name, not position: a sheet made before a column existed has it elsewhere.
  let jobs = rows.map(r => {
    const o = {};
    JOB_HEADERS.forEach(h => { o[h] = h in ix ? r[ix[h]] : ''; });
    delete o['JD Text'];           // too large to ship to the dashboard
    return o;
  });
  if (e.parameter.status) jobs = jobs.filter(j => j['Status'] === e.parameter.status);

  const count = (field, val) => jobs.filter(j => j[field] === val).length;
  const gates = {};
  jobs.forEach(j => {
    const g = j['Gate Result'];
    if (g && g !== 'Pass') gates[g] = (gates[g] || 0) + 1;
  });

  let lastTick = null;
  try { lastTick = JSON.parse(PropertiesService.getScriptProperties().getProperty('LAST_TICK')); } catch (err) { lastTick = null; }

  const payload = {
    generatedAt: new Date().toISOString(),
    lastTick: lastTick,
    triggers: ScriptApp.getProjectTriggers().map(t => ({
      fn: t.getHandlerFunction(), type: String(t.getEventType()),
    })),
    totals: {
      all: jobs.length,
      passed: count('Gate Result', 'Pass'),
      notApplied: count('Status', 'Not Applied'),
      applied: count('Status', 'Applied'),
      blocked: count('Status', 'Blocked'),
      failed: count('Status', 'Failed'),
      skipped: count('Status', 'Skipped'),
    },
    gateBreakdown: Object.keys(gates).map(k => ({ reason: k, count: gates[k] }))
      .sort((a, b) => b.count - a.count),
    jobs: jobs,
  };
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------ applier callbacks */

/** Called by the applier after each attempt. */
function setStatus(jobIdValue, status, notes) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
    const ix = headerIndex(sh);
    const last = sh.getLastRow();
    const ids = sh.getRange(2, ix['Job ID'] + 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] !== jobIdValue) continue;
      sh.getRange(i + 2, ix['Status'] + 1).setValue(status);
      if (status === 'Applied') sh.getRange(i + 2, ix['Applied At'] + 1).setValue(new Date().toISOString());
      if (notes) sh.getRange(i + 2, ix['Notes'] + 1).setValue(notes);
      return true;
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

/** POST { token, jobId, status, notes } — or { token, rows:[…] } to append. */
function doPost(e) {
  const token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
  if (body.token !== token) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  let out;
  if (body.action === 'tick') {
    // The dashboard's "Run pipeline" button. Re-identifies, enriches and gates.
    // It cannot start Spark (no API) or the applier (runs locally).
    hourlyTick();
    let tick = null;
    try { tick = JSON.parse(PropertiesService.getScriptProperties().getProperty('LAST_TICK')); } catch (err) { tick = null; }
    out = { ok: true, lastTick: tick };
  }
  else if (body.rows) out = { ok: true, added: appendNewJobs(body.rows) };
  else if (body.jobId) out = { ok: setStatus(body.jobId, body.status, body.notes) };
  else out = { error: 'nothing to do' };
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------ JD one-click diagnostics */
/* Real links from the Jobs tab, one per ATS. debugJd takes arguments and the
   Run button cannot supply any, so these wrappers exist for the dropdown. */

function testJdAutodesk() {   // Workday, tenant in the host
  debugJd('https://autodesk.wd1.myworkdayjobs.com/en-US/Ext/job/Software-Engineer_26WD96707-1');
}
function testJdVeradigm() {   // Workday, different tenant + site
  debugJd('https://veradigm.wd12.myworkdayjobs.com/en-US/VR/job/Software-Engineer--Java-_JR10599');
}
function testJdLever() {
  debugJd('https://jobs.lever.co/mindtickle/b6e024c2-42c2-463c-8bc8-ca0aa0826845');
}
function testJdAshby() {
  debugJd('https://jobs.ashbyhq.com/tekion/e23792bd-a9ee-4dfe-8223-9c0b9fe90f05');
}
function testJdSmartRecruiters() {
  debugJd('https://jobs.smartrecruiters.com/unacademy/743999672726735');
}
