/**
 * JobOps v3 — Wellfound (formerly AngelList Talent) as a source.
 *
 * Wellfound has no public API, but its role pages ship their results inside the page as
 * JSON (Next.js `__NEXT_DATA__`), and a plain request gets them — no key, no login, and
 * no browser needed, which is what makes this usable from Apps Script.
 *
 * Each listing arrives with the description and the years-of-experience range the
 * employer set, so the experience gate can judge these rows the moment they land instead
 * of waiting for enrichment.
 *
 * Caveat worth remembering: this reads a page's internal data, not a supported API. It
 * will break the day Wellfound changes that shape — hence `wellfoundHealth()`, and the
 * Sources row that records how many jobs each page returned.
 *
 * Applying is a separate problem: most Wellfound listings apply through Wellfound itself,
 * which needs an account, so these rows are leads until a job links out to a real ATS.
 *
 * First run: wellfoundPoll() — or wellfoundHealth() to see what one page returns.
 */

const WELLFOUND_CURSOR = 'WELLFOUND_CURSOR';
const WELLFOUND_PAGES_PER_RUN = 6;

/** Role slugs Wellfound uses. Each is fetched for India, one page at a time. */
const WELLFOUND_ROLES = [
  'software-engineer',
  'backend-engineer',
  'full-stack-engineer',
  'frontend-engineer',
  'java-developer',
  'python-developer',
];
const WELLFOUND_LOCATION = 'india';
const WELLFOUND_MAX_PAGE = 3;

/** Every role/page combination, in a stable order so the cursor means something. */
function wellfoundTargets() {
  const out = [];
  for (const role of WELLFOUND_ROLES) {
    for (let page = 1; page <= WELLFOUND_MAX_PAGE; page++) {
      out.push({
        role: role,
        page: page,
        url: 'https://wellfound.com/role/l/' + role + '/' + WELLFOUND_LOCATION + (page > 1 ? '?page=' + page : ''),
      });
    }
  }
  return out;
}

/**
 * The jobs one Wellfound page is showing: { company, role, location, applyLink, jd,
 * yearsMin }. Returns [] rather than throwing — a source that breaks must not take the
 * hourly tick down with it.
 */
function wellfoundFetch(url) {
  let html;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return { jobs: [], note: 'HTTP ' + res.getResponseCode() };
    html = res.getContentText();
  } catch (e) {
    return { jobs: [], note: String(e).slice(0, 80) };
  }
  return { jobs: parseWellfound(html), note: '' };
}

/**
 * Pull the listings out of a Wellfound role page.
 *
 * The page's Apollo cache holds `JobListingSearchResult:<id>` entries and
 * `StartupResult:<id>` entries; a startup points at its own listings through
 * `highlightedJobListings`, which is the only place the company name lives.
 */
function parseWellfound(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
  if (!m) return [];

  let data;
  try {
    data = JSON.parse(m[1]).props.pageProps.apolloState.data;
  } catch (e) {
    return [];
  }
  if (!data) return [];

  // listing id -> company name, read from each startup's own list.
  const companyOf = {};
  for (const key of Object.keys(data)) {
    if (key.indexOf('StartupResult:') !== 0) continue;
    const startup = data[key];
    const listings = startup.highlightedJobListings || [];
    for (const ref of listings) {
      const id = String(ref && ref.__ref ? ref.__ref : '').split(':')[1];
      if (id) companyOf[id] = startup.name || '';
    }
  }

  const jobs = [];
  for (const key of Object.keys(data)) {
    if (key.indexOf('JobListingSearchResult:') !== 0) continue;
    const job = data[key];
    const id = String(job.id || key.split(':')[1] || '');
    if (!id || !job.title) continue;

    const places = job.locationNames || [];
    const location = places.length ? places.join(', ') : (job.remote ? 'Remote' : '');

    jobs.push({
      company: companyOf[id] || '',
      role: job.title,
      location: location,
      salary: job.compensation || 'NA',
      // The canonical public URL for a listing. Rebuilt rather than read: the page
      // stores the slug and the id separately and never the link itself.
      applyLink: 'https://wellfound.com/jobs/' + id + '-' + (job.slug || 'job'),
      jd: String(job.description || '').replace(/\s+/g, ' ').trim().slice(0, 20000),
      yearsMin: typeof job.yearsExperienceMin === 'number' ? job.yearsExperienceMin : null,
    });
  }
  return jobs;
}

/**
 * Poll a slice of the role pages and append whatever passes the same relevance check the
 * board sources use, plus Wellfound's own years-of-experience floor when it states one.
 */
function wellfoundPoll(maxPages) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { polled: 0, added: 0, note: 'locked' };
  try {
    const targets = wellfoundTargets();
    const props = PropertiesService.getScriptProperties();
    let cursor = parseInt(props.getProperty(WELLFOUND_CURSOR) || '0', 10);
    if (!(cursor >= 0) || cursor >= targets.length) cursor = 0;

    const pol = readPolicies();
    const maxYears = parseInt(polVal(pol, 'experience_max_years', '3'), 10);
    const budget = maxPages || WELLFOUND_PAGES_PER_RUN;
    const started = Date.now();
    const batch = [];
    let polled = 0, seen = 0;

    while (polled < budget && (Date.now() - started) < 240000) {
      const target = targets[cursor % targets.length];
      cursor++;
      polled++;

      const got = wellfoundFetch(target.url);
      seen += got.jobs.length;
      for (const job of got.jobs) {
        if (!job.company || !looksRelevant(job, pol)) continue;
        // Wellfound states the floor outright, so it can be judged before enrichment.
        if (job.yearsMin !== null && job.yearsMin > maxYears) continue;
        batch.push(job);
      }
      Logger.log('wellfound ' + target.role + ' p' + target.page + ': ' +
        got.jobs.length + ' seen' + (got.note ? ' (' + got.note + ')' : ''));

      if (cursor >= targets.length) { cursor = 0; break; }
    }

    const added = batch.length ? appendNewJobs(batch) : 0;
    props.setProperty(WELLFOUND_CURSOR, String(cursor));
    Logger.log('wellfoundPoll: ' + polled + ' pages, ' + seen + ' seen, ' + batch.length + ' relevant, ' + added + ' new');
    return { polled: polled, seen: seen, relevant: batch.length, added: added };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Diagnostic. Reading a page's internals is brittle by nature, so this says plainly
 * whether the shape still holds: zero jobs from a page that loads means Wellfound
 * changed something, not that India has no engineers.
 */
function wellfoundHealth() {
  const target = wellfoundTargets()[0];
  const got = wellfoundFetch(target.url);
  Logger.log('url    = ' + target.url);
  Logger.log('jobs   = ' + got.jobs.length + (got.note ? ' (' + got.note + ')' : ''));
  if (!got.jobs.length) {
    Logger.log('RESULT = BROKEN or blocked — the page gave no listings. Check the page shape.');
    return 0;
  }
  const pol = readPolicies();
  const kept = got.jobs.filter(j => j.company && looksRelevant(j, pol));
  Logger.log('kept   = ' + kept.length + ' after the relevance check');
  got.jobs.slice(0, 5).forEach(j =>
    Logger.log('  ' + (j.company || '(no company)') + ' — ' + j.role + ' — ' + (j.location || '(no location)') +
      (j.yearsMin === null ? '' : ' — wants ' + j.yearsMin + '+ yrs')));
  return got.jobs.length;
}
