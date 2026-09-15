#!/usr/bin/env node
import 'dotenv/config';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { loadPersonalFacts } from './personal.js';
import { resumeForJob, stageResume } from './resume.js';
import { fetchEligibleJobs, writeStatus, requeueIfBlocked } from './sheet.js';
import { AnswerStore } from './questions.js';
import { collectAnswers } from './discord.js';
import { Browser } from './browser.js';
import { getAdapter, SUPPORTED_ATS } from './adapters/index.js';
import type { Job, ApplyOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Every job whose submit button was clicked, one JSON line each. Written before the
 * Sheet write-back: if that write fails the Sheet still says "Not Applied", and
 * without this file the next run would apply to the same job a second time.
 */
const LEDGER = resolve(__dirname, '..', 'submitted.jsonl');

function loadSubmitted(): Set<string> {
  if (!existsSync(LEDGER)) return new Set();
  return new Set(
    readFileSync(LEDGER, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { jobId: string }).jobId),
  );
}

function recordSubmitted(job: Job, status: string, notes: string): void {
  appendFileSync(
    LEDGER,
    JSON.stringify({ jobId: job['Job ID'], company: job['Company Name'], role: job['Role'], status, notes, at: new Date().toISOString() }) + '\n',
  );
}

/* ── CLI args ─────────────────────────────────────────────────────── */

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    submit: false,
    headed: false,
    jobId: null as string | null,
    limit: 5,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--submit':
        opts.submit = true;
        break;
      case '--headed':
        opts.headed = true;
        break;
      case '--job-id':
        opts.jobId = args[++i] ?? null;
        break;
      case '--limit': {
        const raw = args[++i];
        const n = Number(raw);
        // A typo here must not turn into "no limit" while --submit is on.
        if (!Number.isInteger(n) || n < 1) {
          console.error(`❌ --limit needs a positive whole number, got "${raw ?? ''}"`);
          process.exit(1);
        }
        opts.limit = n;
        break;
      }
      case '--help':
      case '-h':
        opts.help = true;
        break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
JobOps v3 Applier — Fill and submit job applications

Usage:
  npx tsx src/cli.ts [options]

Options:
  --job-id <id>   Apply to a specific job (e.g. greenhouse:7771208)
  --submit        Actually submit the form (default: dry-run, fill only)
  --headed        Show the browser window (default: headless)
  --limit <n>     Max jobs to process in one run (default: 5)
  -h, --help      Show this help

Environment:
  SHEET_API_URL    Apps Script web app /exec URL
  SHEET_API_TOKEN  The token from showToken()

Examples:
  npx tsx src/cli.ts                                # dry-run all eligible
  npx tsx src/cli.ts --job-id greenhouse:123 --headed  # one job, visible
  npx tsx src/cli.ts --submit --limit 3             # submit up to 3
`);
}

/* ── main ─────────────────────────────────────────────────────────── */

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate env
  const apiUrl = process.env.SHEET_API_URL;
  const apiToken = process.env.SHEET_API_TOKEN;
  if (!apiUrl || !apiToken) {
    console.error(
      '❌ SHEET_API_URL and SHEET_API_TOKEN must be set. ' +
        'Copy .env.example to .env and fill in the values.',
    );
    process.exit(1);
  }

  // Load personal facts
  console.log('📋 Loading personal facts from data/personal.md...');
  const personalFacts = await loadPersonalFacts();
  console.log(`   ${personalFacts.size} approved facts loaded`);

  // Answers first: a job answered in Discord since the last run is filled with them now.
  const answers = new AnswerStore();
  try {
    const got = await collectAnswers(answers, async (jobId) => {
      if (await requeueIfBlocked(apiUrl, apiToken, jobId)) console.log(`   ↩️  ${jobId}: back in the queue`);
    });
    if (got.saved || got.rejected) {
      console.log(`📥 Discord: ${got.saved} answer(s) saved, ${got.rejected} rejected, ${got.completed.length} job(s) fully answered`);
    }
    for (const who of new Set(got.ignoredAuthors)) {
      console.log(`   🚫 Ignored a reply from ${who} — not in DISCORD_ALLOWED_USER_IDS`);
    }
  } catch (err) {
    console.warn(`⚠️  Could not read Discord replies: ${err instanceof Error ? err.message : err}`);
  }

  // Fetch eligible jobs
  console.log('📡 Fetching eligible jobs from Sheet...');
  let jobs = await fetchEligibleJobs(apiUrl, apiToken);
  console.log(`   ${jobs.length} eligible jobs (Status=Not Applied, Gate=Pass)`);

  if (jobs.length === 0) {
    console.log('✅ Nothing to do — no eligible jobs.');
    process.exit(0);
  }

  // Filter to specific job if requested
  if (args.jobId) {
    jobs = jobs.filter((j) => j['Job ID'] === args.jobId);
    if (jobs.length === 0) {
      console.error(
        `❌ Job "${args.jobId}" not found or not eligible.`,
      );
      process.exit(1);
    }
  }

  const alreadySubmitted = loadSubmitted();
  const resubmits = jobs.filter((j) => alreadySubmitted.has(j['Job ID']));
  if (resubmits.length > 0) {
    console.log(
      `⏭️  Skipping ${resubmits.length} job(s) already submitted per submitted.jsonl ` +
        `(the Sheet still says Not Applied — fix their Status by hand): ` +
        resubmits.map((j) => j['Job ID']).join(', '),
    );
    jobs = jobs.filter((j) => !alreadySubmitted.has(j['Job ID']));
  }

  // Filter to supported ATSes first
  const supportedAll = jobs.filter((j) =>
    SUPPORTED_ATS.includes(j['ATS']?.toLowerCase()),
  );
  const unsupported = jobs.filter(
    (j) => !SUPPORTED_ATS.includes(j['ATS']?.toLowerCase()),
  );

  if (unsupported.length > 0) {
    console.log(
      `⏭️  Skipping ${unsupported.length} jobs on unsupported ATSes: ` +
        [...new Set(unsupported.map((j) => j['ATS']))].join(', '),
    );
  }

  // Limit supported jobs
  let supported = supportedAll;
  if (supported.length > args.limit) {
    console.log(`   Limiting to ${args.limit} supported jobs (use --limit to change)`);
    supported = supported.slice(0, args.limit);
  }


  if (supported.length === 0) {
    console.log(
      '✅ No supported-ATS jobs to process. Supported: ' +
        SUPPORTED_ATS.join(', '),
    );
    process.exit(0);
  }

  console.log(
    `\n${'='.repeat(60)}\n` +
      `${args.submit ? '🚀 LIVE MODE — will submit' : '🧪 DRY-RUN — will fill but NOT submit'}\n` +
      `${supported.length} jobs to process\n` +
      `${'='.repeat(60)}\n`,
  );

  // Shared browser + paths
  const profileDir = resolve(__dirname, '..', '.browser-profile');
  const screenshotDir = resolve(__dirname, '..', 'screenshots');
  const browser = new Browser(profileDir, args.headed, screenshotDir);

  let applied = 0;
  let blocked = 0;
  let failed = 0;

  try {
    for (let i = 0; i < supported.length; i++) {
      const job = supported[i];
      console.log(
        `\n[${i + 1}/${supported.length}] ${job['Company Name']} — ${job['Role']}`,
      );
      console.log(`   Job ID: ${job['Job ID']}`);
      console.log(`   ATS: ${job['ATS']}`);
      console.log(`   Link: ${job['Apply Link']}`);

      const adapter = getAdapter(job['ATS']);
      if (!adapter) {
        console.log('   ⏭️  No adapter — skipping');
        continue;
      }

      const variant = resumeForJob(job);
      const resumePath = stageResume(variant.path, personalFacts.get('full_name') ?? '');
      console.log(`   📄 Resume: ${basename(variant.path)} (${variant.source}) → uploaded as ${basename(resumePath)}`);

      const opts: ApplyOptions = {
        submit: args.submit,
        headed: args.headed,
        profileDir,
        screenshotDir,
        personalFacts,
        resumePath,
        browser,
        answers,
      };

      const result = await adapter.apply(job, opts);

      console.log(`   → ${result.status}: ${result.notes}`);
      if (result.screenshots.length > 0) {
        console.log(`   → ${result.screenshots.length} screenshot(s) saved`);
      }

      if (result.submitted) recordSubmitted(job, result.status, result.notes);

      // Dry-run writes nothing. A live run writes every outcome, Blocked included —
      // a Blocked job left as "Not Applied" is re-attempted, and re-notified, forever.
      if (args.submit) {
        const ok = await writeStatus(apiUrl, apiToken, job['Job ID'], result.status, result.notes);
        if (ok) {
          console.log('   ✅ Status written to Sheet');
        } else if (result.submitted) {
          console.log('   ⚠️  Failed to write status to Sheet — submitted.jsonl still prevents a re-apply');
        } else {
          console.log('   ⚠️  Failed to write status to Sheet');
        }
      }

      switch (result.status) {
        case 'Applied':
          applied++;
          break;
        case 'Blocked':
          blocked++;
          break;
        case 'Failed':
          failed++;
          break;
      }
    }
  } finally {
    await browser.close();
  }

  console.log(
    `\n${'='.repeat(60)}\n` +
      `Done. Applied: ${applied}, Blocked: ${blocked}, Failed: ${failed}\n` +
      `${'='.repeat(60)}`,
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
