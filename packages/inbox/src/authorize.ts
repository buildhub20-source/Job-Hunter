import { config as loadEnv } from 'dotenv';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildAuthUrl, exchangeCode, type ClientSecret } from './oauth.js';

/**
 * Run this ONCE, interactively, to grant this app read-only access to
 * gopir525@gmail.com. This is Vinoth's Gmail — per progress/03-decisions.md D12,
 * that consent step happens on his own personal machine, never on the Aptean work
 * laptop this was built on. `npm run authorize -w @jobops/inbox` runs it.
 */

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
loadEnv({ path: join(repoRoot, '.env') });
async function loadClientSecret(): Promise<ClientSecret> {
  const path = resolve(repoRoot, process.env.GMAIL_OAUTH_CLIENT_PATH ?? '');
  if (!process.env.GMAIL_OAUTH_CLIENT_PATH) {
    throw new Error('GMAIL_OAUTH_CLIENT_PATH is not set — point it at the client secret JSON downloaded from Google Cloud Console (OAuth client, type "Desktop app")');
  }
  const raw = JSON.parse(await readFile(path, 'utf8')) as { installed?: ClientSecret; web?: ClientSecret };
  const client = raw.installed ?? raw.web;
  if (!client) throw new Error(`${path} doesn't look like a Google OAuth client secret file`);
  return client;
}

async function main(): Promise<void> {
  const client = await loadClientSecret();
  const authUrl = buildAuthUrl(client, REDIRECT_URI);

  console.log('\n1. Open this URL in a browser signed into gopir525@gmail.com:\n');
  console.log(authUrl);
  console.log(`\n2. Approve access. This script is waiting on ${REDIRECT_URI} ...\n`);

  const code = await new Promise<string>((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/oauth2callback') {
        res.statusCode = 404;
        res.end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.end(error ? `Authorization failed: ${error}. You can close this tab.` : 'Authorized. You can close this tab.');
      server.close();
      if (error) reject(new Error(error));
      else if (code) resolvePromise(code);
      else reject(new Error('no code in callback'));
    });
    server.listen(PORT);
  });

  const tokens = await exchangeCode(client, code, REDIRECT_URI);
  const tokenPath = resolve(repoRoot, process.env.GMAIL_TOKEN_PATH ?? 'data/.gmail-token.json');
  await writeFile(tokenPath, JSON.stringify(tokens, null, 2));
  console.log(`\nSaved. GMAIL_TOKEN_PATH should point at: ${tokenPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
