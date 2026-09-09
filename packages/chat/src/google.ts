import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ChatTransport, ApprovalCardInput, NotificationInput, PostResult } from './types.js';
import { buildApprovalCard, buildNotificationCard } from './cards.js';

interface ServiceAccount { client_email: string; private_key: string }

const SCOPE = 'https://www.googleapis.com/auth/chat.bot';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Service-account JWT flow. No dependencies. */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const assertion = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export class GoogleChatTransport implements ChatTransport {
  readonly name = 'google_chat';
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly spaceId: string,
    private readonly serviceAccountPath: string,
  ) {}

  private async auth(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const sa = JSON.parse(await readFile(this.serviceAccountPath, 'utf8')) as ServiceAccount;
    const value = await getAccessToken(sa);
    this.token = { value, expiresAt: Date.now() + 55 * 60 * 1000 };
    return value;
  }

  private async send(body: Record<string, unknown>): Promise<PostResult> {
    const token = await this.auth();
    const space = this.spaceId.startsWith('spaces/') ? this.spaceId : `spaces/${this.spaceId}`;
    const res = await fetch(`https://chat.googleapis.com/v1/${space}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`chat post failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { name?: string; thread?: { name?: string } };
    return { messageId: json.name ?? null, thread: json.thread?.name ?? null };
  }

  postApproval(c: ApprovalCardInput): Promise<PostResult> {
    return this.send(buildApprovalCard(c));
  }
  postNotification(n: NotificationInput): Promise<PostResult> {
    return this.send(buildNotificationCard(n));
  }
}
