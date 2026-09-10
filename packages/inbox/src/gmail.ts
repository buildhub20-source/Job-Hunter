import type { RawEmail } from './types.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailMessageListResponse { messages?: { id: string; threadId: string }[] }

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  payload?: { headers?: { name: string; value: string }[] };
}

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/**
 * Lists message IDs from the last two days (a one-day cadence with a safety margin —
 * `inbox_messages.gmail_message_id` is unique, so re-seeing a message is a no-op, not
 * a duplicate). Read-only: this scope (`gmail.readonly`) cannot reply, archive, star,
 * or delete even if the code tried to.
 */
export async function listRecentMessageIds(accessToken: string): Promise<{ id: string; threadId: string }[]> {
  const url = `${API}/messages?q=${encodeURIComponent('newer_than:2d')}&maxResults=100`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`gmail list failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as GmailMessageListResponse;
  return json.messages ?? [];
}

/**
 * Metadata only — from, subject, date, and Gmail's own short snippet. Never the full
 * body: plan section 14 says to store only sender, subject, timestamp, classification
 * and extracted fields, and the snippet is enough to classify from.
 */
export async function getMessageMetadata(accessToken: string, id: string): Promise<RawEmail> {
  const url = `${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`gmail get failed: ${res.status} ${await res.text()}`);
  const msg = (await res.json()) as GmailMessage;

  const dateHeader = header(msg, 'Date');
  const receivedAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

  return {
    gmailMessageId: msg.id,
    threadId: msg.threadId ?? null,
    from: header(msg, 'From'),
    subject: header(msg, 'Subject'),
    snippet: msg.snippet ?? '',
    receivedAt,
  };
}
