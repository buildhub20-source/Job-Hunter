import type { Job } from './types.js';

/**
 * Client for the Apps Script web app — same endpoints the dashboard uses.
 * Reads eligible jobs and writes status back after an application attempt.
 */

export async function fetchJobs(apiUrl: string, token: string): Promise<Job[]> {
  const res = await fetch(`${apiUrl}?token=${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  const text = await res.text();
  let payload: { jobs?: Job[]; error?: string };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `Sheet API did not return JSON: ${text.slice(0, 200)}`,
    );
  }
  if (payload.error) throw new Error(`Sheet API error: ${payload.error}`);
  return payload.jobs ?? [];
}

/** Status = "Not Applied" AND Gate Result = "Pass". */
export async function fetchEligibleJobs(apiUrl: string, token: string): Promise<Job[]> {
  return (await fetchJobs(apiUrl, token)).filter(
    (j) => j['Status'] === 'Not Applied' && j['Gate Result'] === 'Pass',
  );
}

/**
 * Put a Blocked job back in the queue once every question it was blocked on has an
 * answer. Never one whose submit was already clicked — that needs a human to check.
 */
export async function requeueIfBlocked(apiUrl: string, token: string, jobId: string): Promise<boolean> {
  const job = (await fetchJobs(apiUrl, token)).find((j) => j['Job ID'] === jobId);
  if (!job || job['Status'] !== 'Blocked' || String(job['Notes'] ?? '').startsWith('SUBMIT CLICKED')) {
    return false;
  }
  return writeStatus(apiUrl, token, jobId, 'Not Applied', 'Answers received in Discord — ready to retry');
}

/**
 * Write the outcome of an application attempt back to the Sheet.
 * Uses the doPost endpoint with { token, jobId, status, notes }.
 */
export async function writeStatus(
  apiUrl: string,
  token: string,
  jobId: string,
  status: string,
  notes: string,
): Promise<boolean> {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, jobId, status, notes }),
    redirect: 'follow',
  });
  const text = await res.text();
  let payload: { ok?: boolean; error?: string };
  try {
    payload = JSON.parse(text);
  } catch {
    console.error(`Sheet API write-back did not return JSON: ${text.slice(0, 200)}`);
    return false;
  }
  if (payload.error) {
    console.error(`Sheet API write-back error: ${payload.error}`);
    return false;
  }
  return payload.ok === true;
}
