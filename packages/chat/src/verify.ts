import { createVerify, createPublicKey } from 'node:crypto';

/**
 * Verifies the bearer token Google Chat sends with every webhook call.
 *
 * This matters: the webhook endpoint answers approvals on the user's behalf.
 * Without verification, anyone who can reach the URL could answer a sponsorship
 * question or approve a retry. Zero dependencies — RS256 against Google's certs.
 *
 * https://developers.google.com/workspace/chat/verify-requests
 */

const CERT_URL =
  'https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com';
const ISSUER = 'chat@system.gserviceaccount.com';

let cache: { certs: Record<string, string>; fetchedAt: number } | null = null;
const CACHE_MS = 60 * 60 * 1000;

async function getCerts(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.certs;
  const res = await fetch(CERT_URL);
  if (!res.ok) throw new Error(`could not fetch Chat certs: ${res.status}`);
  const certs = (await res.json()) as Record<string, string>;
  cache = { certs, fetchedAt: Date.now() };
  return certs;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface VerifyResult { ok: boolean; reason?: string }

/** `audience` is your Google Cloud project number. */
export async function verifyChatBearer(token: string, audience: string): Promise<VerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'not a JWT' };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let payload: { iss?: string; aud?: string; exp?: number };
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString('utf8'));
    payload = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed JWT' };
  }

  if (header.alg !== 'RS256') return { ok: false, reason: `unexpected alg ${header.alg}` };
  if (payload.iss !== ISSUER) return { ok: false, reason: `unexpected issuer ${payload.iss}` };
  if (payload.aud !== audience) return { ok: false, reason: 'audience mismatch' };
  if (!payload.exp || payload.exp * 1000 < Date.now()) return { ok: false, reason: 'token expired' };
  if (!header.kid) return { ok: false, reason: 'no kid' };

  const certs = await getCerts();
  const pem = certs[header.kid];
  if (!pem) return { ok: false, reason: 'unknown key id' };

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const valid = verifier.verify(createPublicKey(pem), b64urlToBuffer(sigB64));
  return valid ? { ok: true } : { ok: false, reason: 'bad signature' };
}

/** Constant-time compare for the local dev shared secret. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
