/**
 * JobOps v3 — which resume goes with which job
 *
 * Vinoth keeps several versions of his resume (data/resumes/*.pdf), each leaning on
 * different parts of the same record. This picks one per passing job and writes it
 * to the Jobs tab's Resume column, with the reason in Resume Match. The applier
 * uploads that file.
 *
 * Order of preference:
 *   1. the employer's own tailored file (the Employers column);
 *   2. the version whose keywords the JD mentions most, by weight;
 *   3. the default (amazon) — also the winner of any tie.
 *
 * Keywords describe what each PDF actually says or leads with, read from the files
 * on 2026-09-15. They choose a file; they never add anything to it. Terms every
 * version shares are left out because they can't tell versions apart.
 *
 * Editing: change the Resumes tab, then run rematchResumes(). The tab is created from
 * SEED_RESUMES by setupResumes() and is not overwritten after that.
 */

const RESUMES_SHEET = 'Resumes';
const RESUME_HEADERS = ['Resume', 'Employers', 'Keywords', 'Notes'];
const DEFAULT_RESUME = 'amazon';
const NO_JD_REASON = 'default — no JD text yet';
// How far another version must out-score the default to replace it. One passing
// mention ("frontend", "cloud-native") is not a reason to change resumes.
const MIN_LEAD_OVER_DEFAULT = 3;

// Keywords: comma-separated; "a|b" are spellings of one keyword; ":n" is its weight (default 1).
const SEED_RESUMES = [
  ['amazon', 'amazon',
    'java:1, java 17|jdk 17|java 21|virtual threads:2, spring boot:1, aws:1, soap|wsdl:2, kafka:2, kinesis:2, ' +
    'sonarqube|static analysis:1, junit:1, maven:1, ecs|ec2:1, sqs:1, redis:1, oidc|openid connect:1, ' +
    'ci/cd|github actions:1, elasticsearch:1, hld|lld|low-level design|high-level design:1, solid principles:1, typescript:1',
    'Default. Java-first; widest backend and AWS coverage (JDK 17, SOAP, Kafka, Kinesis)'],
  ['paypal', 'paypal',
    'full stack|full-stack|fullstack:3, frontend|front-end|front end:2, react:2, graphql:3, mongodb|nosql:3, ' +
    'web accessibility|accessible ui|a11y|wcag|aria:3, responsive design|mobile-first|mobile first:2, elk|kibana:2, elasticsearch:1, ' +
    'serverless:2, tracing:1, unit testing|automated testing:1, html|css:1, websocket:1, .net|asp.net:1',
    'Full-stack framing: GraphQL, MongoDB, accessible responsive UI, serverless. No TypeScript'],
  ['angelone', 'angelone, angel one',
    '12-factor|twelve-factor|12 factor:3, distributed systems:2, high-throughput|high throughput:2, caching|redis:2, ' +
    'observability:2, sqs|message queue:1, solid principles:1, hld|lld|low-level design:1, ' +
    'schema design|query optimization:1, concurrency|multithreading:1, cloudwatch:1, websocket:1, typescript:1',
    'Backend at scale: 12-Factor, caching, observability, async queues'],
  ['blueyonder', 'blueyonder, blue yonder',
    'saml:3, oidc|openid connect:2, iam|identity and access|sso|single sign-on:2, oauth:2, rbac:1, devops:2, ' +
    'ci/cd|github actions:2, 12-factor|twelve-factor:2, cloud-native|cloud native:2, observability|alerting:2, ' +
    'azure:1, key vault:1, elasticsearch:1, caching|redis:1, distributed systems:1, sqs:1, typescript:1',
    'Identity and DevOps: OAuth/OIDC/SAML, CI/CD, cloud-native, observability'],
  ['amex', 'amex, americanexpress, american express',
    'test automation|integration testing|functional testing|regression testing|api testing|quality assurance:2, ' +
    'postman:2, stakeholder|stakeholders|cross-functional:1, mentoring|mentor:1, html|css:1, websocket:1, ' +
    'distributed systems:1, typescript:1, openai api:1, embeddings:1',
    'Collaboration and testing: Postman, integration/regression testing, stakeholder demos'],
  ['base', '',
    'full stack|full-stack|fullstack:2, react:1, frontend|front-end:1, .net|asp.net|c#:2, ' +
    'blockchain|web3|solidity|smart contracts:3, ipfs|encryption|cryptography:2, websocket:1, serverless:2, ' +
    'performance optimization:1, html|css:1',
    'The untargeted original: full-stack, .NET, blockchain project'],
  ['fedex', 'fedex',
    'stakeholder|stakeholders|cross-functional:1, mentoring|mentor:1, html|css:1, websocket:1, ' +
    'distributed systems:1, typescript:1, openai api:1, embeddings:1',
    'amex without the testing lines; chosen for FedEx'],
  ['gbt', 'gbt, amexgbt, amex gbt, americanexpressglobalbusinesstravel, american express global business travel',
    'java:1, java 17|jdk 17|java 21|virtual threads:2, spring boot:1, aws:1, soap|wsdl:2, amplify:2, ' +
    'generative ai|genai:1, sonarqube|static analysis:1, junit:1, maven:1, ecs|ec2:1, sqs:1, redis:1, ' +
    'oidc|openid connect:1, ci/cd|github actions:1, elasticsearch:1, hld|lld|low-level design|high-level design:1, ' +
    'solid principles:1, typescript:1',
    'amazon without Kafka/Kinesis, plus AWS Amplify and a GenAI certification'],
  ['p44', 'p44, project44',
    'java:1, java 17|jdk 17|java 21|virtual threads:2, spring boot:1, aws:1, soap|wsdl:2, kafka:2, kinesis:2, ' +
    'sonarqube|static analysis:1, junit:1, maven:1, ecs|ec2:1, sqs:1, redis:1, oidc|openid connect:1, ' +
    'ci/cd|github actions:1, elasticsearch:1, hld|lld|low-level design|high-level design:1, solid principles:1, typescript:1',
    'Same content as amazon; chosen for project44'],
  ['barclays', 'barclays',
    'java:1, spring boot:1, aws:1, sqs:1, redis:1, oidc|openid connect:1, ci/cd|github actions:1, elasticsearch:1, ' +
    'hld|lld|low-level design|high-level design:1, solid principles:1, typescript:1, junit:1, maven:1, ecs|ec2:1',
    'amazon without JDK 17, SOAP, Kafka and SonarQube; chosen for Barclays'],
];

/* ------------------------------------------------------------- pure logic */
/* No Apps Script APIs below this line until the sheet section: the applier's tests
   load these functions into Node. */

function normalizeCompany(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "graphql:3, full stack|full-stack" → [{ terms: ['graphql'], weight: 3 }, …] */
function parseResumeKeywords(cell) {
  return String(cell || '').split(',').map(part => {
    const m = part.trim().match(/^(.*?)(?::\s*(\d+(?:\.\d+)?))?$/);
    const terms = m[1].split('|').map(t => t.trim().toLowerCase()).filter(Boolean);
    return { terms: terms, weight: m[2] ? Number(m[2]) : 1 };
  }).filter(k => k.terms.length);
}

/** Rows of the Resumes tab (or SEED_RESUMES) → profiles. */
function resumeProfiles(rows) {
  return rows
    .filter(r => String(r[0] || '').trim())
    .map(r => ({
      name: String(r[0]).trim(),
      employers: String(r[1] || '').split(',').map(normalizeCompany).filter(Boolean),
      keywords: parseResumeKeywords(r[2]),
    }));
}

/**
 * Whether `term` appears in `text` as whole words. Whole words matter: "java" is inside
 * "javascript" and "react" inside "reactive". Punctuation inside a term (".net",
 * "ci/cd", "c#") is matched literally.
 */
function mentions(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+');
  return new RegExp('(^|[^a-z0-9])' + escaped + '(?=$|[^a-z0-9])', 'i').test(text);
}

/**
 * The resume for one job: { resume, reason }. A keyword counts once however often the
 * JD repeats it — boilerplate repeats itself, and a list of requirements doesn't.
 */
function chooseResume(jdText, company, profiles, defaultName) {
  const fallback = defaultName || DEFAULT_RESUME;
  const byCompany = normalizeCompany(company);
  const own = byCompany && profiles.filter(p => p.employers.indexOf(byCompany) !== -1)[0];
  if (own) return { resume: own.name, reason: 'tailored for ' + company };

  const jd = String(jdText || '');
  if (!jd.trim()) return { resume: fallback, reason: NO_JD_REASON };

  const scored = profiles.map((p, order) => {
    const hits = p.keywords.filter(k => k.terms.some(t => mentions(jd, t)));
    return {
      name: p.name,
      order: order,
      score: hits.reduce((sum, k) => sum + k.weight, 0),
      hits: hits.slice().sort((a, b) => b.weight - a.weight).map(k => k.terms[0]),
    };
  });
  // Highest score wins; a tie goes to the default, then to the order of the tab.
  scored.sort((a, b) =>
    (b.score - a.score) || ((b.name === fallback) - (a.name === fallback)) || (a.order - b.order));

  const best = scored[0];
  if (!best || best.score === 0) return { resume: fallback, reason: 'default — no distinguishing keywords in the JD' };
  const def = scored.filter(s => s.name === fallback)[0];
  if (def && best.name !== fallback && best.score - def.score < MIN_LEAD_OVER_DEFAULT) {
    return {
      resume: fallback,
      reason: 'default — ' + best.name + ' leads by only ' + (best.score - def.score) +
        ' (' + best.hits.slice(0, 3).join(', ') + ')',
    };
  }
  const runnerUp = scored.filter(s => s.name !== best.name)[0];
  return {
    resume: best.name,
    reason: best.hits.slice(0, 5).join(', ') + ' (score ' + best.score +
      (runnerUp ? '; next ' + runnerUp.name + ' ' + runnerUp.score : '') + ')',
  };
}

/* ------------------------------------------------------------------ sheet */

function setupResumes() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(RESUMES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(RESUMES_SHEET);
    sh.getRange(1, 1, 1, RESUME_HEADERS.length).setValues([RESUME_HEADERS]).setFontWeight('bold');
    sh.getRange(2, 1, SEED_RESUMES.length, RESUME_HEADERS.length).setValues(SEED_RESUMES);
    sh.setFrozenRows(1);
  }
  ensureJobColumns();
  Logger.log('Resumes tab ready. Run rematchResumes() to fill the Resume column.');
}

function readResumeProfiles() {
  const sh = SpreadsheetApp.getActive().getSheetByName(RESUMES_SHEET);
  if (!sh || sh.getLastRow() < 2) return resumeProfiles(SEED_RESUMES);
  return resumeProfiles(sh.getRange(2, 1, sh.getLastRow() - 1, RESUME_HEADERS.length).getValues());
}

/**
 * Fill Resume / Resume Match for passing, unapplied jobs. By default only rows with no
 * resume yet, or ones that fell back to the default for lack of a JD that has since
 * arrived. `all` recomputes every unapplied passing row — after editing the Resumes tab.
 */
function matchResumes(all) {
  const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
  ensureJobColumns();
  const ix = headerIndex(sh);
  const last = sh.getLastRow();
  if (last < 2) return 0;

  const profiles = readResumeProfiles();
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const resumes = [], reasons = [];
  let changed = 0;

  for (const row of data) {
    let resume = row[ix['Resume']];
    let reason = row[ix['Resume Match']];
    const jd = row[ix['JD Text']];
    // Skipped rows are duplicates and never applied to, so they get no resume either.
    const status = String(row[ix['Status']] || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const eligible = row[ix['Gate Result']] === 'Pass' && status !== 'Applied' && status !== 'Skipped';
    const stale = !resume || (reason === NO_JD_REASON && jd);
    if (eligible && (all || stale)) {
      const pick = chooseResume(jd, row[ix['Company Name']], profiles, DEFAULT_RESUME);
      if (pick.resume !== resume || pick.reason !== reason) changed++;
      resume = pick.resume; reason = pick.reason;
    } else if (all && status === 'Skipped' && resume) {
      resume = ''; reason = ''; changed++;
    }
    resumes.push([resume]); reasons.push([reason]);
  }
  sh.getRange(2, ix['Resume'] + 1, resumes.length, 1).setValues(resumes);
  sh.getRange(2, ix['Resume Match'] + 1, reasons.length, 1).setValues(reasons);
  Logger.log('matchResumes: ' + changed + ' rows changed');
  return changed;
}

/** Recompute every unapplied passing row. Run after editing the Resumes tab. */
function rematchResumes() {
  return matchResumes(true);
}

/**
 * Diagnostic: how every version scores against one job, so a surprising pick can be
 * read rather than guessed at.  debugResume('greenhouse:8736877002')
 */
function debugResume(jobIdValue) {
  const sh = SpreadsheetApp.getActive().getSheetByName(JOBS_SHEET);
  const ix = headerIndex(sh);
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const row = data.filter(r => r[ix['Job ID']] === jobIdValue)[0];
  if (!row) { Logger.log('no row with Job ID ' + jobIdValue); return; }
  const jd = row[ix['JD Text']];
  readResumeProfiles().forEach(p => {
    const hits = p.keywords.filter(k => k.terms.some(t => mentions(jd, t)));
    Logger.log(p.name + ' = ' + hits.reduce((s, k) => s + k.weight, 0) + '  [' +
      hits.map(k => k.terms[0] + ':' + k.weight).join(', ') + ']');
  });
  Logger.log('→ ' + JSON.stringify(chooseResume(jd, row[ix['Company Name']], readResumeProfiles(), DEFAULT_RESUME)));
}
