/**
 * JobOps v3 — Sheet pipeline
 * See docs/V3-SparkFlow.md. Spark writes rows; this script gives them identity,
 * enriches them from the ATS's own API, runs the gates, and serves the dashboard.
 *
 * First run:
 *   1. setupSheet()      — creates the Jobs and Policies tabs
 *   2. installTriggers() — hourly + onChange
 *   3. Deploy > New deployment > Web app (Execute as me, Anyone with the link)
 *      then read the token with showToken()
 */

const JOBS_SHEET = 'Jobs';
const POLICIES_SHEET = 'Policies';

const JOB_HEADERS = [
  'Job ID', 'Company Name', 'Role', 'Location', 'Salary', 'Apply Link', 'ATS',
  'Job Match', 'Gate Result', 'Status', 'Applied At', 'Notes', 'JD Text', 'Discovered At',
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

/** Pull the real posting from the ATS's own public JSON API. Free, no key. */
function fetchJd(ats, tenant, reqId) {
  let url = null;
  if (ats === 'greenhouse') url = 'https://boards-api.greenhouse.io/v1/boards/' + tenant + '/jobs/' + reqId;
  else if (ats === 'lever')  url = 'https://api.lever.co/v0/postings/' + tenant + '/' + reqId;
  else if (ats === 'smartrecruiters') url = 'https://api.smartrecruiters.com/v1/companies/' + tenant + '/postings/' + reqId;
  if (!url) return null;

  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const j = JSON.parse(res.getContentText());

  if (ats === 'greenhouse') {
    return { jd: stripHtml(j.content || ''), location: (j.location && j.location.name) || '' };
  }
  if (ats === 'lever') {
    return { jd: stripHtml(j.descriptionPlain || j.description || ''),
             location: (j.categories && j.categories.location) || '' };
  }
  return { jd: stripHtml(j.jobAd ? JSON.stringify(j.jobAd) : ''),
           location: (j.location && j.location.city) || '' };
}

function stripHtml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
}

/** Enrich rows that have no JD Text yet. Capped per run to stay inside quota. */
function enrichPending(limit) {
  const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
  const ix = headerIndex(sh);
  const last = sh.getLastRow();
  if (last < 2) return 0;

  const data = sh.getRange(2, 1, last - 1, JOB_HEADERS.length).getValues();
  let done = 0;
  for (let i = 0; i < data.length && done < (limit || 40); i++) {
    const row = data[i];
    if (row[ix['JD Text']]) continue;
    const parsed = jobId(row[ix['Apply Link']], row[ix['Company Name']], row[ix['Role']], row[ix['Location']]);
    if (parsed.ats === 'other') continue;
    const reqId = String(parsed.id).split(':')[1];

    let got = null;
    try { got = fetchJd(parsed.ats, parsed.tenant, reqId); } catch (e) { got = null; }
    if (!got) continue;

    sh.getRange(i + 2, ix['JD Text'] + 1).setValue(got.jd);
    if (got.location) sh.getRange(i + 2, ix['Location'] + 1).setValue(got.location);
    done++;
  }
  return done;
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
    if (verdict === 'Pass' && pol['country'] && loc) {
      // Comma-separated list: a location passes if it matches ANY entry. Postings
      // usually say "Bangalore", not "India", so the country name alone is not enough.
      const accepted = pol['country'].value.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (accepted.length && !accepted.some(c => loc.indexOf(c) !== -1)) {
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
  const identified = normalizeRows();
  const enriched = enrichPending(40);
  const gated = applyGates();
  PropertiesService.getScriptProperties().setProperty('LAST_TICK', JSON.stringify({
    at: new Date().toISOString(), identified: identified, enriched: enriched, gated: gated,
  }));
  Logger.log('hourlyTick: identified=' + identified + ' enriched=' + enriched + ' gated=' + gated);
}

function onSheetChange(e) {
  if (!e || (e.changeType !== 'INSERT_ROW' && e.changeType !== 'EDIT')) return;
  normalizeRows();
  applyGates();
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
  const head = JOB_HEADERS;
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, head.length).getValues() : [];

  let jobs = rows.map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i]; });
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
