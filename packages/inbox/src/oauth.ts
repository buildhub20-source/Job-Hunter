export interface ClientSecret {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** One-time setup only — see authorize.ts. Not called by the daily scan. */
export function buildAuthUrl(client: ClientSecret, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** One-time setup only — see authorize.ts. Not called by the daily scan. */
export async function exchangeCode(client: ClientSecret, code: string, redirectUri: string): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`code exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  if (!json.refresh_token) {
    throw new Error('no refresh_token in response — remove any prior grant at myaccount.google.com/permissions and retry with prompt=consent');
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token, expiry_date: Date.now() + json.expires_in * 1000 };
}

/** Called by the daily scan every run — access tokens expire in ~1 hour. */
export async function refreshAccessToken(client: ClientSecret, refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}
