#!/usr/bin/env node
import 'dotenv/config';
import { AnswerStore } from './questions.js';
import { collectAnswers, discordConfig } from './discord.js';
import { requeueIfBlocked } from './sheet.js';

/**
 * Read replies to the applier's Discord questions and save the answers.
 *
 *   npm run answers              one pass
 *   npm run answers -- --watch   keep checking every 15s, confirming replies as they come
 *
 * `npm run apply` also does one pass before it starts, so this is only needed to get
 * confirmations back while the applier isn't running.
 */

const watch = process.argv.includes('--watch');
const c = discordConfig();
if (!c.botToken || !c.channelId) {
  console.error('❌ DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID must be set to read replies.');
  process.exit(1);
}

async function pass(): Promise<void> {
  const store = new AnswerStore();
  const { SHEET_API_URL: url, SHEET_API_TOKEN: token } = process.env;
  const summary = await collectAnswers(store, async (jobId) => {
    if (url && token && (await requeueIfBlocked(url, token, jobId))) {
      console.log(`   ↩️  ${jobId}: back to "Not Applied" in the Sheet`);
    }
  });

  if (summary.saved || summary.rejected) {
    console.log(`📥 ${summary.saved} answer(s) saved, ${summary.rejected} rejected`);
  }
  for (const jobId of summary.completed) console.log(`   ✅ ${jobId}: all questions answered`);
  for (const who of new Set(summary.ignoredAuthors)) {
    console.log(`   🚫 Ignored a reply from ${who} — add that ID to DISCORD_ALLOWED_USER_IDS if it should count`);
  }
}

await pass();
if (watch) {
  console.log('👀 Watching for replies every 15s — Ctrl+C to stop');
  setInterval(() => void pass().catch((err) => console.error('⚠️ ', err instanceof Error ? err.message : err)), 15000);
}
