import { one } from '@jobops/db';

export interface MatchResult {
  applicationId: string;
  method: 'requisition_id' | 'employer_domain_window';
  confidence: number;
}

/**
 * Plan section 14: requisition ID in the body, then ATS thread/message ID, then
 * employer domain + recent submission window. (The ATS thread/message ID tier isn't
 * implemented — applications carries no such column today; nothing currently writes
 * one, so there's nothing to match against yet.) Anything not confidently matched
 * returns null and the message lands on the dashboard as unmatched — never a guess.
 */
export async function matchToApplication(
  requisitionId: string | null,
  fromAddress: string,
): Promise<MatchResult | null> {
  if (requisitionId) {
    const row = await one<{ id: string }>(
      `SELECT id FROM applications WHERE requisition_id = $1 ORDER BY submitted_at DESC NULLS LAST LIMIT 1`,
      [requisitionId],
    );
    if (row) return { applicationId: row.id, method: 'requisition_id', confidence: 0.95 };
  }

  const domain = fromAddress.split('@')[1]?.toLowerCase();
  if (domain) {
    const row = await one<{ id: string }>(
      `SELECT a.id FROM applications a
       JOIN companies c ON c.id = a.canonical_employer_id
       WHERE a.submitted_at > now() - interval '30 days'
         AND c.careers_url ILIKE '%' || $1 || '%'
       ORDER BY a.submitted_at DESC LIMIT 1`,
      [domain],
    );
    if (row) return { applicationId: row.id, method: 'employer_domain_window', confidence: 0.6 };
  }

  return null;
}
