/**
 * JobOps v3 — is the job still open?
 *
 * Roughly 40% of the rows in the sheet were postings that had already been taken down:
 * they inflate every count, and the applier spends a browser session discovering it.
 * This checks each row against the ATS that published it, once a day.
 *
 * A row found closed becomes Status = 'Closed' with the reason and the date, which takes
 * it out of the applier's queue (it wants 'Not Applied') and out of the dashboard's
 * active view. After ARCHIVE_AFTER_DAYS it moves to the Archive tab, so the Jobs tab
 * stays readable and nothing is ever actually thrown away.
 *
 * Never touched: rows already Applied, and rows already Closed.
 *
 * Setup: run installTriggers() again to add the daily trigger.
 * By hand: checkLiveness() walks a slice; checkAllLiveness() keeps going to the end.
 */

const ARCHIVE_SHEET = 'Archive';
const ARCHIVE_AFTER_DAYS = 7;
const LIVENESS_CURSOR = 'LIVENESS_CURSOR';
const LIVENESS_PER_RUN = 120;      // rows per run; the 6-minute cap is the real limit
const LIVENESS_BUDGET_MS = 240000;

/* --------------------------------------------------------------- probing */

/**
 * 'closed', 'open', or 'unknown' for one posting.
 *
 * Only an ATS that answers about this exact job can close a row. Anything unclear stays
 * 'unknown' and the row is left alone: a wrongly closed row costs a real application,
 * while an extra stale row costs one browser session.
 */
function probeJob(applyLink, company) {
  const url = String(applyLink || '');
  if (!url) return { state: 'unknown', reason: 'no apply link' };
  const bare = url.split(/[?#]/)[0];
  let m;

  // ---- Greenhouse ----------------------------------------------------------
  m = bare.match(/greenhouse\.io\/([^\/]+)\/jobs\/(\d+)/i);
  const gh = url.match(/[?&]gh_jid=(\d+)/i);
  if (m || gh) {
    const tenant = m ? m[1] : String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const id = m ? m[2] : gh[1];
    if (!tenant) return { state: 'unknown', reason: 'no board name in the link' };
    return byCode('https://boards-api.greenhouse.io/v1/boards/' + tenant + '/jobs/' + id, 'greenhouse');
  }

  // ---- Lever ---------------------------------------------------------------
  m = bare.match(/lever\.co\/([^\/]+)\/([0-9a-f-]{16,})/i);
  if (m) return byCode('https://api.lever.co/v0/postings/' + m[1] + '/' + m[2], 'lever');

  // ---- SmartRecruiters -----------------------------------------------------
  m = bare.match(/smartrecruiters\.com\/([^\/]+)\/(\d+)/i);
  if (m) return byCode('https://api.smartrecruiters.com/v1/companies/' + m[1] + '/postings/' + m[2], 'smartrecruiters');

  // ---- Amazon --------------------------------------------------------------
  const az = amazonJdUrl(url);
  if (az) return byCode(az, 'amazon');

  // ---- Workday -------------------------------------------------------------
  const wd = workdayJdUrl(url);
  if (wd) return byCode(wd, 'workday');

  // ---- Ashby: no per-posting endpoint, so read the board and look for the id -
  m = bare.match(/ashbyhq\.com\/([^\/]+)\/([0-9a-f-]{16,})/i);
  if (m) {
    const board = jdGet('https://api.ashbyhq.com/posting-api/job-board/' + m[1]);
    if (!board || !board.jobs) return { state: 'unknown', reason: 'ashby board did not answer' };
    const hit = board.jobs.filter(function (x) { return String(x.id) === m[2]; })[0];
    return hit ? { state: 'open', reason: 'ashby' } : { state: 'closed', reason: 'not on the Ashby board any more' };
  }

  // ---- Anything else: the careers page itself ------------------------------
  return probePage(url);
}

/** An ATS API that answers 404/410 for this job id has taken it down. */
function byCode(url, via) {
  let res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { Accept: 'application/json' } });
  } catch (e) {
    return { state: 'unknown', reason: String(e).slice(0, 80) };
  }
  const code = res.getResponseCode();
  if (code === 404 || code === 410) return { state: 'closed', reason: via + ' returned ' + code };
  if (code === 200) return { state: 'open', reason: via };
  return { state: 'unknown', reason: via + ' returned ' + code };
}

const CLOSED_PAGE = /no longer (?:open|accepting|available|active)|position (?:has been |is )?(?:closed|filled)|posting (?:has )?(?:closed|expired)|job (?:not found|has been removed)|this (?:job|role|position) is closed/i;

/**
 * A direct careers page. Only an explicit 404/410 or the page's own "closed" wording
 * counts — a login wall, a bot check or a slow page must never close a live row.
 */
function probePage(url) {
  let res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  } catch (e) {
    return { state: 'unknown', reason: String(e).slice(0, 80) };
  }
  const code = res.getResponseCode();
  if (code === 404 || code === 410) return { state: 'closed', reason: 'page returned ' + code };
  if (code !== 200) return { state: 'unknown', reason: 'page returned ' + code };

  const body = String(res.getContentText() || '').replace(/<[^>]+>/g, ' ');
  const said = CLOSED_PAGE.exec(body);
  return said
    ? { state: 'closed', reason: 'page says "' + said[0] + '"' }
    : { state: 'open', reason: 'page loads' };
}

/* ----------------------------------------------------------------- sweep */

/**
 * Check a slice of the sheet, continuing where the last run stopped. Returns
 * { checked, closed, wrapped } — `wrapped` means the cursor reached the end and the
 * next run starts again from the top.
 */
function checkLiveness(limit) {
  const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
  ensureJobColumns();
  const ix = headerIndex(sh);
  const last = sh.getLastRow();
  if (last < 2) return { checked: 0, closed: 0, wrapped: true };

  const props = PropertiesService.getScriptProperties();
  const n = last - 1;
  const data = sh.getRange(2, 1, n, sh.getLastColumn()).getValues();
  const started = Date.now();
  const cap = limit || LIVENESS_PER_RUN;
  const today = new Date().toISOString().slice(0, 10);

  let cursor = parseInt(props.getProperty(LIVENESS_CURSOR) || '0', 10);
  if (!(cursor >= 0) || cursor >= n) cursor = 0;

  let checked = 0, closed = 0, i = cursor, wrapped = false;
  for (let step = 0; step < n && checked < cap; step++) {
    if (Date.now() - started > LIVENESS_BUDGET_MS) break;
    const row = data[i];
    const rowNumber = i + 2;
    i++;
    if (i >= n) { i = 0; wrapped = true; }

    const status = String(row[ix['Status']] || '').replace(/[​-‍﻿]/g, '').trim();
    if (status === 'Applied' || status === 'Closed') continue;
    if (!row[ix['Apply Link']]) continue;

    let verdict;
    try {
      verdict = probeJob(row[ix['Apply Link']], row[ix['Company Name']]);
    } catch (e) {
      verdict = { state: 'unknown', reason: String(e).slice(0, 80) };
    }
    checked++;
    if (ix['Last Checked'] !== undefined) sh.getRange(rowNumber, ix['Last Checked'] + 1).setValue(today);

    if (verdict.state === 'closed') {
      sh.getRange(rowNumber, ix['Status'] + 1).setValue('Closed');
      sh.getRange(rowNumber, ix['Notes'] + 1).setValue('Closed ' + today + ' — ' + verdict.reason);
      closed++;
      Logger.log('closed: ' + row[ix['Company Name']] + ' — ' + verdict.reason);
    }
  }

  props.setProperty(LIVENESS_CURSOR, String(i));
  Logger.log('checkLiveness: ' + checked + ' checked, ' + closed + ' closed' + (wrapped ? ' (reached the end)' : ''));
  return { checked: checked, closed: closed, wrapped: wrapped };
}

/** Walk the whole sheet, a slice at a time. For a first run or after a big import. */
function checkAllLiveness() {
  let total = { checked: 0, closed: 0 };
  for (let pass = 0; pass < 20; pass++) {
    const out = checkLiveness();
    total.checked += out.checked;
    total.closed += out.closed;
    if (out.wrapped || out.checked === 0) break;
  }
  Logger.log('checkAllLiveness: ' + total.checked + ' checked, ' + total.closed + ' closed');
  return total;
}

/* --------------------------------------------------------------- archive */

/**
 * Move rows closed more than ARCHIVE_AFTER_DAYS ago to the Archive tab. Rows are copied
 * first and deleted afterwards, bottom-up so the indexes below stay valid.
 */
function archiveClosed(days) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(JOBS_SHEET);
    const ix = headerIndex(sh);
    const last = sh.getLastRow();
    if (last < 2) return 0;

    let archive = ss.getSheetByName(ARCHIVE_SHEET);
    if (!archive) {
      archive = ss.insertSheet(ARCHIVE_SHEET);
      archive.getRange(1, 1, 1, JOB_HEADERS.length).setValues([JOB_HEADERS]).setFontWeight('bold');
      archive.setFrozenRows(1);
      archive.getRange(1, 1, archive.getMaxRows(), JOB_HEADERS.length).setNumberFormat('@');
    }

    const width = sh.getLastColumn();
    const data = sh.getRange(2, 1, last - 1, width).getValues();
    const cutoff = Date.now() - (days || ARCHIVE_AFTER_DAYS) * 86400000;
    const move = [], rowNumbers = [];

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][ix['Status']]).trim() !== 'Closed') continue;
      // "Closed 2026-09-27 — greenhouse returned 404"
      const when = /Closed (\d{4}-\d{2}-\d{2})/.exec(String(data[i][ix['Notes']] || ''));
      if (!when) continue;
      if (new Date(when[1]).getTime() > cutoff) continue;
      move.push(data[i]);
      rowNumbers.push(i + 2);
    }
    if (!move.length) { Logger.log('archiveClosed: nothing old enough'); return 0; }

    archive.getRange(archive.getLastRow() + 1, 1, move.length, width).setValues(move);
    for (let j = rowNumbers.length - 1; j >= 0; j--) sh.deleteRow(rowNumbers[j]);
    Logger.log('archiveClosed: moved ' + move.length + ' rows');
    return move.length;
  } finally {
    lock.releaseLock();
  }
}

/** The daily trigger: check a slice, then archive whatever has aged out. */
function dailyLivenessTick() {
  const out = checkLiveness();
  let archived = 0;
  try { archived = archiveClosed(); } catch (e) { Logger.log('archiveClosed failed: ' + e); }
  PropertiesService.getScriptProperties().setProperty('LAST_LIVENESS', JSON.stringify({
    at: new Date().toISOString(), checked: out.checked, closed: out.closed, archived: archived,
  }));
}
