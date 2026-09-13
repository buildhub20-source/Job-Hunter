/**
 * JobOps v3 — deterministic source layer.
 *
 * Spark is a scout: it searches, it is slow, and its recall varies run to run.
 * This file is the opposite — a fixed list of company boards polled directly
 * from each ATS's own public JSON API. Free, no key, no scraping, and it
 * returns the full job description, which is what makes the experience gate
 * actually fire instead of silently passing every ungated row.
 *
 * First run:
 *   1. setupSources()  — creates the Sources tab and seeds it
 *   2. probeSources()  — verifies every tenant, marks the dead ones
 *   3. pollSources()   — the real thing; also wired into hourlyTick()
 */

const SOURCES_SHEET = 'Sources';

const SOURCE_HEADERS = [
  'ATS', 'Tenant', 'Site', 'Active', 'Last Poll', 'Last Count', 'Status', 'Notes',
];

/**
 * Seed list. Tenants are NOT guaranteed — v2 shipped 7 dead Lever boards
 * because nobody checked. Run probeSources() after setup; anything that
 * answers 404 is marked inactive with the reason, and you grow the list from
 * there rather than trusting it blind.
 *
 * Site is only used by Workday (the careers-site slug in the URL).
 */
const SEED_SOURCES = [
  ['greenhouse',      'stripe',       '', 'yes', '', '', '', ''],
  ['greenhouse',      'databricks',   '', 'yes', '', '', '', ''],
  ['greenhouse',      'cloudflare',   '', 'yes', '', '', '', ''],
  ['greenhouse',      'doordash',     '', 'yes', '', '', '', ''],
  ['greenhouse',      'dropbox',      '', 'yes', '', '', '', ''],
  ['greenhouse',      'samsara',      '', 'yes', '', '', '', ''],
  ['greenhouse',      'postman',      '', 'yes', '', '', '', ''],
  ['greenhouse',      'sentry',       '', 'yes', '', '', '', ''],
  ['lever',           'leverdemo',    '', 'no',  '', '', '', 'known-good probe target, not a real employer'],
  ['ashby',           'linear',       '', 'yes', '', '', '', ''],
  ['ashby',           'ramp',         '', 'yes', '', '', '', ''],
  ['smartrecruiters', 'Visa',         '', 'yes', '', '', '', ''],
  ['smartrecruiters', 'Bosch',        '', 'yes', '', '', '', ''],
  ['workday',         'mastercard',   'CorporateCareers', 'yes', '', '', '', 'wd1'],
  ['workday',         'accenture',    'AccentureCareers', 'yes', '', '', '', 'wd103'],
  ['workday',         'autodesk',     'Ext',              'yes', '', '', '', 'wd1'],
];

/* ------------------------------------------------------------------ setup */

function setupSources() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SOURCES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SOURCES_SHEET);
    sh.getRange(1, 1, 1, SOURCE_HEADERS.length).setValues([SOURCE_HEADERS]).setFontWeight('bold');
    sh.getRange(2, 1, SEED_SOURCES.length, SOURCE_HEADERS.length).setValues(SEED_SOURCES);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), SOURCE_HEADERS.length).setNumberFormat('@');
  }
  Logger.log('Sources tab ready with ' + (sh.getLastRow() - 1) + ' rows. Run probeSources() next.');
}

function readSources(onlyActive) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SOURCES_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const ix = headerIndex(sh);
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, SOURCE_HEADERS.length).getValues();
  const out = [];
  vals.forEach((r, i) => {
    const active = String(r[ix['Active']]).trim().toLowerCase() === 'yes';
    if (onlyActive && !active) return;
    if (!String(r[ix['Tenant']]).trim()) return;
    out.push({
      rowNumber: i + 2,
      ats:    String(r[ix['ATS']]).trim().toLowerCase(),
      tenant: String(r[ix['Tenant']]).trim(),
      site:   String(r[ix['Site']]).trim(),
      notes:  String(r[ix['Notes']]).trim(),
    });
  });
  return out;
}

function writeSourceResult(rowNumber, count, status) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SOURCES_SHEET);
  const ix = headerIndex(sh);
  sh.getRange(rowNumber, ix['Last Poll'] + 1).setValue(new Date().toISOString());
  sh.getRange(rowNumber, ix['Last Count'] + 1).setValue(String(count));
  sh.getRange(rowNumber, ix['Status'] + 1).setValue(status);
}

/* ---------------------------------------------------------------- fetchers */

function jsonGet(url, opts) {
  const res = UrlFetchApp.fetch(url, Object.assign({
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'Accept': 'application/json' },
  }, opts || {}));
  const code = res.getResponseCode();
  if (code !== 200) return { error: 'HTTP ' + code };
  try {
    return { data: JSON.parse(res.getContentText()) };
  } catch (e) {
    return { error: 'bad JSON' };
  }
}

/** Workday's tenant host lives in the Notes column as wd1 / wd5 / wd103. */
function workdayHost(tenant, notes) {
  const m = String(notes).match(/wd\d+/i);
  return 'https://' + tenant + '.' + (m ? m[0].toLowerCase() : 'wd1') + '.myworkdayjobs.com';
}

/**
 * Returns a normalized list of { company, role, location, salary, applyLink }
 * for one board, or { error } if the board could not be read.
 */
function fetchBoard(src) {
  const ats = src.ats;

  if (ats === 'greenhouse') {
    const r = jsonGet('https://boards-api.greenhouse.io/v1/boards/' + src.tenant + '/jobs');
    if (r.error) return { error: r.error };
    return {
      jobs: (r.data.jobs || []).map(j => ({
        company: src.tenant,
        role: j.title || '',
        location: (j.location && j.location.name) || '',
        salary: 'NA',
        applyLink: j.absolute_url || '',
      })),
    };
  }

  if (ats === 'lever') {
    const r = jsonGet('https://api.lever.co/v0/postings/' + src.tenant + '?mode=json');
    if (r.error) return { error: r.error };
    const list = Array.isArray(r.data) ? r.data : [];
    return {
      jobs: list.map(j => ({
        company: src.tenant,
        role: j.text || '',
        location: (j.categories && j.categories.location) || '',
        salary: (j.salaryRange && j.salaryRange.min) ? String(j.salaryRange.min) : 'NA',
        applyLink: j.hostedUrl || '',
      })),
    };
  }

  if (ats === 'ashby') {
    const r = jsonGet('https://api.ashbyhq.com/posting-api/job-board/' + src.tenant);
    if (r.error) return { error: r.error };
    return {
      jobs: (r.data.jobs || []).map(j => ({
        company: src.tenant,
        role: j.title || '',
        location: j.location || '',
        salary: 'NA',
        applyLink: j.jobUrl || '',
      })),
    };
  }

  if (ats === 'smartrecruiters') {
    const r = jsonGet('https://api.smartrecruiters.com/v1/companies/' + src.tenant + '/postings?limit=100');
    if (r.error) return { error: r.error };
    return {
      jobs: (r.data.content || []).map(j => ({
        company: src.tenant,
        role: j.name || '',
        location: j.location
          ? [j.location.city, j.location.country].filter(String).join(', ')
          : '',
        salary: 'NA',
        applyLink: 'https://jobs.smartrecruiters.com/' + src.tenant + '/' + j.id,
      })),
    };
  }

  if (ats === 'workday') {
    // Undocumented but stable. Workday is 63% of the current pipeline, so it
    // earns the special case. POST, not GET.
    const host = workdayHost(src.tenant, src.notes);
    const url = host + '/wday/cxs/' + src.tenant + '/' + src.site + '/jobs';
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
    });
    if (res.getResponseCode() !== 200) return { error: 'HTTP ' + res.getResponseCode() };
    let data;
    try { data = JSON.parse(res.getContentText()); } catch (e) { return { error: 'bad JSON' }; }
    return {
      jobs: (data.jobPostings || []).map(j => ({
        company: src.tenant,
        role: j.title || '',
        location: j.locationsText || '',
        salary: 'NA',
        applyLink: host + '/' + src.site + (j.externalPath || ''),
      })),
    };
  }

  return { error: 'unknown ATS "' + ats + '"' };
}

/* ----------------------------------------------------------------- filter */

/**
 * readPolicies() returns { key: { value, type } } — NOT a plain string. Reading
 * pol.country directly and calling .split on it is how the first version of this
 * filter dropped 2,238 Greenhouse postings and kept zero. Accept either shape.
 */
function polVal(pol, key, fallback) {
  const v = pol && pol[key];
  if (!v) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v.value === 'string') return v.value;
  return fallback;
}

/**
 * Cheap pre-filter so we do not write thousands of irrelevant rows into the
 * Sheet. Deliberately loose — the real decision is still the gates in
 * Code.gs. This only drops the obvious misses.
 */
function looksRelevant(job, pol) {
  const title = String(job.role || '').toLowerCase();
  if (!title) return false;

  const required = polVal(pol, 'required_title_words', 'engineer,developer,sde,programmer')
    .toLowerCase().split(',').map(s => s.trim()).filter(String);
  if (required.length && !required.some(w => title.indexOf(w) >= 0)) return false;

  // Blocked words are checked outside parentheticals, same rule as the gate —
  // "Software Engineer (Secrets Manager)" is not a manager role.
  const main = title.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const blocked = polVal(pol, 'blocked_title_words', 'senior,staff,principal,manager,director,lead,architect')
    .toLowerCase().split(',').map(s => s.trim()).filter(String);
  if (blocked.some(w => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(main))) {
    return false;
  }

  // Boards write the city alone ("Bengaluru"), not "Bengaluru, India", so the
  // country name by itself is not enough — match against the full city list.
  const loc = String(job.location || '').toLowerCase();
  const places = polVal(pol, 'country',
    'india,bengaluru,bangalore,chennai,coimbatore,hyderabad,pune,mumbai,delhi,noida,gurgaon,gurugram')
    .toLowerCase().split(',').map(s => s.trim()).filter(String);
  // A blank location is a REJECT, not a free pass. Skipping the check when the
  // string was empty is how two Accenture roles in London and Newcastle landed
  // in an India-only sheet.
  if (!loc) return false;
  if (places.length && !places.some(p => loc.indexOf(p) >= 0)) return false;

  return true;
}

/**
 * Diagnostic. Logs what one board actually returns and how many survive each
 * stage of the filter, so a zero-kept result can be explained instead of guessed at.
 * Example:  debugBoard('greenhouse', 'stripe')
 */
function debugBoard(ats, tenant, site, notes) {
  const src = { ats: ats, tenant: tenant, site: site || '', notes: notes || '' };
  const r = fetchBoard(src);
  if (r.error) { Logger.log('FAILED: ' + r.error); return; }

  const pol = readPolicies();
  Logger.log('policy country  = ' + polVal(pol, 'country', '(fallback)'));
  Logger.log('policy required = ' + polVal(pol, 'required_title_words', '(fallback)'));
  Logger.log('policy blocked  = ' + polVal(pol, 'blocked_title_words', '(fallback)'));
  Logger.log('total postings  = ' + r.jobs.length);

  const withLink = r.jobs.filter(j => j.applyLink);
  Logger.log('with apply link = ' + withLink.length);
  Logger.log('first posting   = ' + JSON.stringify(r.jobs[0] || null));

  const kept = withLink.filter(j => looksRelevant(j, pol));
  Logger.log('KEPT            = ' + kept.length);
  kept.slice(0, 15).forEach(j => Logger.log('  + ' + j.role + '  |  ' + j.location));

  // Everything in the target geography that the TITLE rules threw away. This is
  // what separates "this employer has no junior India roles" from "my title
  // filter is too aggressive" — without it both look identical from the outside.
  const places = polVal(pol, 'country', 'india').toLowerCase()
    .split(',').map(s => s.trim()).filter(String);
  const inGeo = withLink.filter(j => {
    const l = String(j.location || '').toLowerCase();
    return l && places.some(p => l.indexOf(p) >= 0);
  });
  const dropped = inGeo.filter(j => !looksRelevant(j, pol));
  Logger.log('in geography    = ' + inGeo.length + ', of which dropped on title = ' + dropped.length);
  dropped.slice(0, 25).forEach(j => Logger.log('  - ' + j.role));

  const locs = {};
  r.jobs.forEach(j => { const k = j.location || '(blank)'; locs[k] = (locs[k] || 0) + 1; });
  const top = Object.keys(locs).sort((a, b) => locs[b] - locs[a]).slice(0, 12);
  Logger.log('top locations   = ' + top.map(k => k + ' (' + locs[k] + ')').join(' | '));
}

/* ------------------------------------------------------------------- poll */

/**
 * Poll a slice of the source list. Apps Script caps a single execution at six
 * minutes, so we keep a cursor in script properties and walk the list a few
 * boards at a time. Over successive hourly ticks the whole list gets covered.
 */
function pollSources(maxBoards) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { polled: 0, added: 0, note: 'locked' };
  try {
    const sources = readSources(true);
    if (!sources.length) return { polled: 0, added: 0, note: 'no active sources' };

    const props = PropertiesService.getScriptProperties();
    let cursor = parseInt(props.getProperty('SOURCE_CURSOR') || '0', 10);
    if (isNaN(cursor) || cursor >= sources.length) cursor = 0;

    const pol = readPolicies();
    const budget = maxBoards || 6;
    const started = Date.now();

    let polled = 0, added = 0;
    const batch = [];

    while (polled < budget && (Date.now() - started) < 240000) {
      const src = sources[cursor % sources.length];
      cursor++;
      polled++;

      let result;
      try { result = fetchBoard(src); } catch (e) { result = { error: String(e) }; }

      if (result.error) {
        writeSourceResult(src.rowNumber, 0, 'ERROR: ' + result.error);
      } else {
        const kept = result.jobs.filter(j => j.applyLink && looksRelevant(j, pol));
        kept.forEach(j => batch.push(j));
        writeSourceResult(src.rowNumber, kept.length, 'ok (' + result.jobs.length + ' seen)');
      }

      if (cursor >= sources.length) { cursor = 0; break; }
    }

    if (batch.length) added = appendNewJobs(batch);
    props.setProperty('SOURCE_CURSOR', String(cursor));
    props.setProperty('LAST_SOURCE_POLL', new Date().toISOString());

    Logger.log('pollSources: ' + polled + ' boards, ' + batch.length + ' relevant, ' + added + ' new');
    return { polled: polled, relevant: batch.length, added: added, cursor: cursor };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Verify every tenant in the Sources tab and deactivate the ones that 404.
 * Run this after editing the list. This is the check v2 never had — seven of
 * its twenty boards were dead slugs and it reported zero jobs as if that were
 * a real result.
 */
function probeSources() {
  const sources = readSources(false);
  const sh = SpreadsheetApp.getActive().getSheetByName(SOURCES_SHEET);
  const ix = headerIndex(sh);
  let ok = 0, dead = 0;

  sources.forEach(src => {
    let result;
    try { result = fetchBoard(src); } catch (e) { result = { error: String(e) }; }
    if (result.error) {
      dead++;
      sh.getRange(src.rowNumber, ix['Active'] + 1).setValue('no');
      writeSourceResult(src.rowNumber, 0, 'DEAD: ' + result.error);
    } else {
      ok++;
      writeSourceResult(src.rowNumber, result.jobs.length, 'ok (' + result.jobs.length + ' postings)');
    }
  });

  Logger.log('probeSources: ' + ok + ' live, ' + dead + ' dead. Dead rows were set Active=no.');
  return { live: ok, dead: dead };
}

/* --------------------------------------------------- one-click diagnostics */
/* debugBoard() takes arguments and the Run button cannot supply any, so these
   wrappers exist to be picked straight from the function dropdown. */

function testStripe()     { debugBoard('greenhouse', 'stripe'); }
function testDatabricks() { debugBoard('greenhouse', 'databricks'); }
function testRamp()       { debugBoard('ashby', 'ramp'); }
function testMastercard() { debugBoard('workday', 'mastercard', 'CorporateCareers', 'wd1'); }

/* ------------------------------------------------------- tenant discovery */

/**
 * Candidate employers with real engineering headcount in India — Indian product
 * companies plus the India-heavy engineering orgs of global firms. We do not
 * know which ATS any of them use, or whether the slug below is right. That is
 * the point: findTenants() tries each slug against every ATS and keeps only what
 * answers, so the list is discovered rather than asserted.
 */
const CANDIDATE_TENANTS = [
  'razorpay', 'postman', 'hasura', 'browserstack', 'chargebee', 'freshworks',
  'zeta', 'cred', 'meesho', 'groww', 'zerodha', 'innovaccer', 'whatfix',
  'mindtickle', 'darwinbox', 'leadsquared', 'clevertap', 'sprinklr', 'gupshup',
  'exotel', 'moengage', 'capillarytech', 'icertis', 'druva', 'nutanix',
  'arcesium', 'tekion', 'highradius', 'uniphore', 'observeai', 'skyflow',
  'atlan', 'plivo', 'slice', 'khatabook', 'scaler', 'unacademy', 'upgrad',
  'swiggy', 'zomato', 'phonepe', 'flipkart', 'myntra', 'dream11', 'games24x7',
  'navi', 'jupiter', 'setu', 'juspay', 'signzy', 'rippling', 'airbase',
  'thoughtspot', 'postmanlabs', 'hackerrank', 'hackerearth', 'chargebeeinc',
];

/**
 * Try one slug against every ATS and return the first that answers, with a
 * count of how many postings survive the geography and title filters. A board
 * that is live but has no junior India engineering roles is not worth polling,
 * so `kept` — not `total` — is the number that decides.
 */
function identifyTenant(slug, pol) {
  const attempts = [
    { ats: 'greenhouse',      tenant: slug, site: '', notes: '' },
    { ats: 'lever',           tenant: slug, site: '', notes: '' },
    { ats: 'ashby',           tenant: slug, site: '', notes: '' },
    { ats: 'smartrecruiters', tenant: slug, site: '', notes: '' },
  ];
  for (const src of attempts) {
    let r;
    try { r = fetchBoard(src); } catch (e) { continue; }
    if (r.error || !r.jobs || !r.jobs.length) continue;

    const withLink = r.jobs.filter(j => j.applyLink);
    const kept = withLink.filter(j => looksRelevant(j, pol));
    return { ats: src.ats, total: r.jobs.length, kept: kept.length,
             samples: kept.slice(0, 3).map(j => j.role + ' | ' + j.location) };
  }
  return null;
}

/**
 * Probe a slice of CANDIDATE_TENANTS and append every hit to the Sources tab.
 * Sliced because each candidate costs up to four HTTP calls and Apps Script
 * stops an execution at six minutes.
 *
 *   findTenants(0, 14)   then   findTenants(14, 14)   and so on.
 */
function findTenants(start, count) {
  const from = start || 0;
  const take = count || 14;
  const pol = readPolicies();
  const sh = SpreadsheetApp.getActive().getSheetByName(SOURCES_SHEET);
  const ix = headerIndex(sh);

  const existing = new Set(
    readSources(false).map(s => (s.ats + '|' + s.tenant).toLowerCase())
  );

  const slice = CANDIDATE_TENANTS.slice(from, from + take);
  const found = [], added = [];
  const started = Date.now();

  for (const slug of slice) {
    if (Date.now() - started > 240000) { Logger.log('time budget reached'); break; }
    const hit = identifyTenant(slug, pol);
    if (!hit) { Logger.log('  .  ' + slug + ' — no board on any ATS'); continue; }

    Logger.log('  ok ' + slug + '  [' + hit.ats + ']  total=' + hit.total + '  kept=' + hit.kept);
    hit.samples.forEach(s => Logger.log('        ' + s));
    found.push(slug);

    const key = (hit.ats + '|' + slug).toLowerCase();
    if (hit.kept > 0 && !existing.has(key)) {
      sh.appendRow([hit.ats, slug, '', 'yes', new Date().toISOString(),
                    String(hit.kept), 'ok (' + hit.total + ' postings)', 'auto-discovered']);
      existing.add(key);
      added.push(slug);
    }
  }

  Logger.log('findTenants(' + from + ',' + take + '): ' + found.length + ' boards found, ' +
             added.length + ' added to Sources — ' + added.join(', '));
  Logger.log('next: findTenants(' + (from + take) + ', ' + take + ')');
  return { found: found, added: added };
}

function findTenants1() { findTenants(0, 14); }
function findTenants2() { findTenants(14, 14); }
function findTenants3() { findTenants(28, 14); }
function findTenants4() { findTenants(42, 14); }
