import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { query, one } from '@jobops/db';
import { canTransition, type JobState } from '@jobops/shared';
import type { ChatTransport } from '@jobops/chat';
import { notify } from '@jobops/approvals';
import { refreshAccessToken, type ClientSecret, type TokenSet } from './oauth.js';
import { listRecentMessageIds, getMessageMetadata } from './gmail.js';
import { classifyDeterministic } from './classify.js';
import { classifyWithLLM } from './classifyLLM.js';
import { extractRequisitionId } from './extract.js';
import { matchToApplication } from './match.js';
import type { InboxClass, RawEmail } from './types.js';

export interface InboxScanSummary {
  fetched: number;
  stored: number;
  alreadySeen: number;
  matched: number;
  unmatched: number;
  transitioned: number;
  errors: { gmailMessageId: string; error: string }[];
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Where an inbox classification tries to move an in-flight application. */
const TARGET_STATE: Partial<Record<InboxClass, JobState>> = {
  confirmation: 'SUBMITTED_VERIFIED',
  rejection: 'REJECTED',
  interview: 'INTERVIEW',
  offer: 'OFFER',
  // assessment intentionally omitted: the state machine only allows entering
  // BLOCKED_HUMAN from APPLYING, but an assessment email commonly arrives once an
  // application already shows as submitted — see the note in classifyAndApply().
};

async function loadTokens(): Promise<{ client: ClientSecret; tokens: TokenSet }> {
  const clientPath = resolve(repoRoot, process.env.GMAIL_OAUTH_CLIENT_PATH ?? '');
  const tokenPath = resolve(repoRoot, process.env.GMAIL_TOKEN_PATH ?? 'data/.gmail-token.json');
  if (!process.env.GMAIL_OAUTH_CLIENT_PATH) {
    throw new Error('GMAIL_OAUTH_CLIENT_PATH is not set');
  }
  const raw = JSON.parse(await readFile(clientPath, 'utf8')) as { installed?: ClientSecret; web?: ClientSecret };
  const client = raw.installed ?? raw.web;
  if (!client) throw new Error(`${clientPath} doesn't look like a Google OAuth client secret file`);
  const tokens = JSON.parse(await readFile(tokenPath, 'utf8')) as TokenSet;
  return { client, tokens };
}

async function classify(email: RawEmail): Promise<{ classification: InboxClass; confidence: number }> {
  return classifyDeterministic(email) ?? (await classifyWithLLM(email));
}

async function applyOutcome(
  transport: ChatTransport, applicationId: string, classification: InboxClass, email: RawEmail,
): Promise<boolean> {
  const app = await one<{ status: JobState; evidence_level: string }>(
    `SELECT status, evidence_level FROM applications WHERE id = $1`, [applicationId],
  );
  if (!app) return false;

  const target = TARGET_STATE[classification];
  let transitioned = false;

  if (target && canTransition(app.status, target)) {
    await query(`UPDATE applications SET status = $2, updated_at = now() WHERE id = $1`, [applicationId, target]);
    await query(
      `INSERT INTO application_events (application_id, from_state, to_state, reason, actor)
       VALUES ($1,$2,$3,$4,'inbox_worker')`,
      [applicationId, app.status, target, `inbox: ${classification} — "${email.subject}"`],
    );
    if (classification === 'confirmation' && app.evidence_level === 'E0') {
      await query(`UPDATE applications SET evidence_level = 'E1' WHERE id = $1`, [applicationId]);
    }
    transitioned = true;
  }

  if (classification === 'interview' || classification === 'offer') {
    await notify(transport, {
      kind: classification, title: `${classification === 'interview' ? 'Interview' : 'Offer'}: ${email.subject}`,
      body: `From ${email.from}`, applicationId, severity: 'high',
    });
  } else if (classification === 'assessment') {
    // Not a legal transition from a submitted state today (see TARGET_STATE) — still
    // worth a human's attention, so notify without touching status.
    await notify(transport, {
      kind: 'assessment', title: `Assessment: ${email.subject}`, body: `From ${email.from}`,
      applicationId, severity: 'high',
    });
  } else if (classification === 'action_required') {
    await notify(transport, {
      kind: 'action_required', title: `Action required: ${email.subject}`, body: `From ${email.from}`,
      applicationId,
    });
  }

  return transitioned;
}

/**
 * One daily read-only scan. Plan section 14. Never replies, archives, or deletes —
 * the OAuth scope (gmail.readonly) cannot do those even if the code tried to.
 */
export async function runInboxScan(transport: ChatTransport): Promise<InboxScanSummary> {
  const summary: InboxScanSummary = {
    fetched: 0, stored: 0, alreadySeen: 0, matched: 0, unmatched: 0, transitioned: 0, errors: [],
  };

  const { client, tokens } = await loadTokens();
  const accessToken = await refreshAccessToken(client, tokens.refresh_token);

  const ids = await listRecentMessageIds(accessToken);
  summary.fetched = ids.length;

  for (const { id } of ids) {
    try {
      const email = await getMessageMetadata(accessToken, id);
      const { classification, confidence } = await classify(email);
      const requisitionId = extractRequisitionId(`${email.subject}\n${email.snippet}`);
      const match = classification === 'unrelated' || classification === 'job_alert' || classification === 'recruiter'
        ? null
        : await matchToApplication(requisitionId, email.from);

      const inserted = await one<{ id: string }>(
        `INSERT INTO inbox_messages
           (gmail_message_id, thread_id, from_address, subject, received_at, classification,
            matched_application_id, match_confidence, match_method, extracted_fields)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (gmail_message_id) DO NOTHING
         RETURNING id`,
        [
          email.gmailMessageId, email.threadId, email.from, email.subject, email.receivedAt, classification,
          match?.applicationId ?? null, match?.confidence ?? null, match?.method ?? null,
          JSON.stringify({ classifierConfidence: confidence, requisitionId }),
        ],
      );

      if (!inserted) { summary.alreadySeen++; continue; }
      summary.stored++;

      if (match) {
        summary.matched++;
        const transitioned = await applyOutcome(transport, match.applicationId, classification, email);
        if (transitioned) summary.transitioned++;
      } else if (classification !== 'unrelated' && classification !== 'job_alert' && classification !== 'recruiter') {
        summary.unmatched++;
      }
    } catch (err) {
      summary.errors.push({ gmailMessageId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}
