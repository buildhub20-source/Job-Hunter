import 'dotenv/config';
import { resolve } from 'node:path';
import { loadProfile, staleFacts, factValue } from './load.js';

const dataDir = resolve(process.env.JOBOPS_DATA_DIR ?? './data');
const cmd = process.argv[2] ?? 'check';

const bundle = await loadProfile(dataDir);

if (cmd === 'check') {
  console.log(`data dir       ${dataDir}`);
  console.log(`facts          ${bundle.facts.length} (${bundle.facts.filter((f) => f.usable).length} usable)`);
  console.log(`policies       ${bundle.policies.length} (${bundle.hardGates.length} hard gates, ${bundle.rankingSignals.length} ranking)`);
  console.log(`policy version ${bundle.policyVersion}`);

  const stale = staleFacts(bundle);
  if (stale.length) {
    console.log(`\nstale facts (expired, need reconfirmation):`);
    for (const f of stale) console.log(`  ${f.key}  expired ${f.expires_at}`);
  }
  const unusable = bundle.facts.filter((f) => !f.usable);
  if (unusable.length) {
    console.log(`\nnot usable (agent will ask instead of guessing):`);
    for (const f of unusable) console.log(`  ${f.key}`);
  }
  if (bundle.issues.length) {
    console.log(`\nISSUES:`);
    for (const i of bundle.issues) console.log(`  ${i.file} [${i.line}] ${i.message}`);
    process.exit(1);
  }
  console.log('\nok');
} else if (cmd === 'show') {
  const key = process.argv[3];
  if (!key) { console.error('usage: show <key>'); process.exit(1); }
  const v = factValue(bundle, key);
  console.log(v === null ? `${key}: UNKNOWN (would raise an approval)` : `${key}: ${v}`);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
}
