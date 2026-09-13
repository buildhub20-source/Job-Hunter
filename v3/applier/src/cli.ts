#!/usr/bin/env node
import 'dotenv/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPersonalFacts } from './personal.js';
import { pickResume } from './resume.js';
import { fetchEligibleJobs, writeStatus } from './sheet.js';
import { Browser } from './browser.js';
import { getAdapter, SUPPORTED_ATS } from './adapters/index.js';
import type { Job, ApplyOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      case '--limit':
        opts.limit = parseInt(args[++i] ?? '5', 10);
        break;
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

      const resumePath = pickResume(job['Company Name']);
      console.log(`   📄 Resume: ${resumePath}`);

      const opts: ApplyOptions = {
        submit: args.submit,
        headed: args.headed,
        profileDir,
        screenshotDir,
        personalFacts,
        resumePath,
        browser,
      };

      const result = await adapter.apply(job, opts);

      console.log(`   → ${result.status}: ${result.notes}`);
      if (result.screenshots.length > 0) {
        console.log(`   → ${result.screenshots.length} screenshot(s) saved`);
      }

      // Write status back (skip write-back for dry-run)
      if (args.submit && result.status !== 'Blocked') {
        const ok = await writeStatus(
          apiUrl,
          apiToken,
          job['Job ID'],
          result.status,
          result.notes,
        );
        console.log(
          ok
            ? '   ✅ Status written to Sheet'
            : '   ⚠️  Failed to write status to Sheet',
        );
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
