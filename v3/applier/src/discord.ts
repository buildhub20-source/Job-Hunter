import type { Job } from './types.js';
import { AnswerStore, type Question, type ReplyOutcome } from './questions.js';

/**
 * Discord as the applier's inbox for questions only a human can answer.
 *
 * A blocked job gets one message from the bot listing its questions by number, with
 * the form's choices where there are any. Vinoth replies to that message; the
 * collector reads replies, checks them against the choices, stores them, and says
 * what it saved. The next run fills the job with them.
 *
 * Posting through the bot, not a webhook, is what makes replying work: the bot can
 * read the channel and tell which job a reply belongs to. Without bot credentials
 * the message still goes out through the webhook, but nothing reads the replies.
 */

const API = 'https://discord.com/api/v10';

interface DiscordConfig {
  botToken?: string;
  channelId?: string;
  webhookUrl?: string;
  allowed: Set<string>;
}

export function discordConfig(env = process.env): DiscordConfig {
  return {
    botToken: env.DISCORD_BOT_TOKEN || undefined,
    channelId: env.DISCORD_CHANNEL_ID || undefined,
    webhookUrl: env.DISCORD_WEBHOOK_URL || undefined,
    allowed: new Set((env.DISCORD_ALLOWED_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)),
  };
}

const canReadReplies = (c: DiscordConfig) => Boolean(c.botToken && c.channelId);

/* ── rendering ─────────────────────────────────────────────────────── */

const clean = (label: string) => label.replace(/\*/g, '').replace(/\s+/g, ' ').trim();

function renderOptions(q: Question, budget: number): string {
  if (!q.options?.length) return 'Type your answer.';
  const head = q.optionsKind === 'choices'
    ? 'Choose one: '
    : 'Searchable list with no exact match. Closest on the site: ';
  const tail = q.optionsKind === 'suggestions' ? '\nReply with one of these, or another name exactly as the site spells it.' : '';

  let out = head;
  let shown = 0;
  for (const o of q.options) {
    const piece = `${shown ? ' · ' : ''}\`${o.replace(/`/g, "'")}\``;
    const more = `… and ${q.options.length - shown} more`;
    if (out.length + piece.length + more.length + tail.length > budget) {
      out += ` ${more}`;
      break;
    }
    out += piece;
    shown++;
  }
  return out + tail;
}

export function questionEmbed(job: Job, questions: Question[]) {
  // Discord caps an embed at 6000 characters and a field value at 1024.
  const budget = Math.min(1000, Math.floor(4500 / Math.max(questions.length, 1)));
  return {
    title: `${job['Company Name']} — ${job['Role']}`.slice(0, 256),
    url: job['Apply Link'],
    color: 0xff9900,
    description:
      'Reply to **this message** with one answer per line, like `1: No`.\n' +
      'Start an answer with `always` to reuse it for the same question on every job — `2: always Company Website`.',
    fields: questions.slice(0, 25).map((q) => ({
      name: `${q.n}. ${clean(q.label)}`.slice(0, 256),
      value: renderOptions(q, budget),
    })),
    footer: { text: job['Job ID'] },
  };
}

export function outcomeText(company: string, outcomes: ReplyOutcome[], stillOpen: number[]): string {
  const saved = outcomes.filter((o) => o.status === 'saved');
  const rejected = outcomes.filter((o) => o.status === 'rejected');
  const lines: string[] = [];

  if (saved.length) {
    lines.push(`✅ **${company}** — saved ` + saved
      .map((o) => (o.status === 'saved' ? `${o.n}: \`${o.answer}\`${o.always ? ' (every job)' : ''}` : ''))
      .join(', '));
  }
  for (const o of rejected) {
    if (o.status === 'rejected') lines.push(`❌ ${o.n}: ${o.message} — reply again with a corrected line.`);
  }
  if (outcomes.length === 0) lines.push('❓ I couldn\'t find any answers here. Use one line per answer, like `1: No`.');

  lines.push(stillOpen.length
    ? `⏳ Still waiting on ${stillOpen.join(', ')}.`
    : '🎉 All answered — they\'ll be used the next time the applier runs.');
  return lines.join('\n');
}

/* ── Discord API ───────────────────────────────────────────────────── */

async function bot<T>(c: DiscordConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${c.botToken}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Discord ${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * Tell Discord what this job is blocked on — unless the same questions were already
 * posted and are still waiting, so a re-run doesn't repeat itself.
 */
export async function askAboutJob(
  store: AnswerStore,
  job: Job,
  blocked: Omit<Question, 'n'>[],
  c = discordConfig(),
): Promise<void> {
  const questions = store.recordBlocked(
    job['Job ID'],
    { company: job['Company Name'], role: job['Role'], applyLink: job['Apply Link'] },
    blocked,
  );
  if (!questions) {
    console.log('  💬 Already asked in Discord — waiting for a reply');
    store.save();
    return;
  }

  const embed = questionEmbed(job, questions);
  try {
    if (canReadReplies(c)) {
      const msg = await bot<{ id: string }>(c, `/channels/${c.channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ embeds: [embed] }),
      });
      store.markAsked(job['Job ID'], msg.id);
      console.log(`  📨 Asked ${questions.length} question(s) in Discord — reply to that message to answer`);
    } else if (c.webhookUrl) {
      const res = await fetch(`${c.webhookUrl}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'Job Hunter Agent', embeds: [embed] }),
      });
      if (!res.ok) throw new Error(`webhook → ${res.status} ${await res.text()}`);
      store.markAsked(job['Job ID'], ((await res.json()) as { id: string }).id);
      console.log('  📨 Posted to Discord via webhook — replies are not read without DISCORD_BOT_TOKEN');
    } else {
      console.log('  ⚠️  No Discord configured; the questions are only in the console');
    }
  } catch (err) {
    console.warn(`  ⚠️  Could not post to Discord: ${err instanceof Error ? err.message : err}`);
  }
  store.save();
}

interface DiscordMessage {
  id: string;
  content: string;
  author: { id: string; username: string; bot?: boolean };
  message_reference?: { message_id?: string };
}

export interface CollectSummary {
  saved: number;
  rejected: number;
  completed: string[];
  ignoredAuthors: string[];
}

/**
 * Read replies since the last pass and apply them. Only replies to one of our question
 * messages, from an allowed person, count — an answer here goes into an application
 * under Vinoth's name.
 */
export async function collectAnswers(
  store: AnswerStore,
  onComplete?: (jobId: string) => Promise<void>,
  c = discordConfig(),
): Promise<CollectSummary> {
  const summary: CollectSummary = { saved: 0, rejected: 0, completed: [], ignoredAuthors: [] };
  if (!canReadReplies(c)) return summary;
  if (c.allowed.size === 0) {
    console.warn('⚠️  DISCORD_ALLOWED_USER_IDS is empty — not reading any answers');
    return summary;
  }

  let after: string | null = store.lastMessageId ?? store.oldestOpenMessageId();
  if (!after) return summary;

  for (;;) {
    const page: DiscordMessage[] = await bot<DiscordMessage[]>(c, `/channels/${c.channelId}/messages?after=${after}&limit=100`);
    const ordered: DiscordMessage[] = [...page].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

    for (const m of ordered) {
      after = m.id;
      if (m.author.bot) continue;
      const hit = m.message_reference?.message_id && store.jobForMessage(m.message_reference.message_id);
      if (!hit) continue;
      if (!c.allowed.has(m.author.id)) {
        summary.ignoredAuthors.push(`${m.author.username} (${m.author.id})`);
        continue;
      }

      const [jobId, job] = hit;
      const wasOpen = store.unanswered(jobId).length > 0;
      const outcomes = store.applyReply(jobId, m.content);
      const stillOpen = store.unanswered(jobId).map((q) => q.n);
      summary.saved += outcomes.filter((o) => o.status === 'saved').length;
      summary.rejected += outcomes.filter((o) => o.status === 'rejected').length;
      store.save();

      await bot(c, `/channels/${c.channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: outcomeText(job.company, outcomes, stillOpen),
          message_reference: { message_id: m.id },
          allowed_mentions: { parse: [] },
        }),
      }).catch((err) => console.warn(`⚠️  Could not confirm in Discord: ${err instanceof Error ? err.message : err}`));

      if (wasOpen && stillOpen.length === 0) {
        summary.completed.push(jobId);
        await onComplete?.(jobId);
      }
    }

    store.lastMessageId = after;
    store.save();
    if (page.length < 100) break;
  }
  return summary;
}
