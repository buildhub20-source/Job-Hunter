import type { Job } from './types.js';

/**
 * Client for the Apps Script web app — same endpoints the dashboard uses.
 * Reads eligible jobs and writes status back after an application attempt.
 */

export async function fetchEligibleJobs(
  apiUrl: string,
  token: string,
): Promise<Job[]> {
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

  const jobs = payload.jobs ?? [];

  // Filter to eligible: Status = "Not Applied" AND Gate Result = "Pass"
  return jobs.filter(
    (j) => j['Status'] === 'Not Applied' && j['Gate Result'] === 'Pass',
  );
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
