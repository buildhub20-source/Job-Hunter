import { createHash } from 'node:crypto';

/**
 * application_key = canonical_employer_id + ats_tenant_id + requisition_id
 * Plan section 6. This is the ONLY duplicate test. Title, JD and company are not.
 */
export function applicationKey(input: {
  canonicalEmployerId: string;
  atsTenantId: string;
  requisitionId: string;
}): string {
  const parts = [input.canonicalEmployerId, input.atsTenantId, input.requisitionId].map((p) =>
    p.trim().toLowerCase(),
  );
  if (parts.some((p) => p.length === 0)) {
    throw new Error('applicationKey requires all three parts; use resolveIdentity() first');
  }
  return parts.join('::');
}

export type IdentitySource =
  | 'requisition_id'
  | 'employer_job_id'
  | 'canonical_ats_url'
  | 'normalized_posting_url'
  | 'composite_fingerprint';

export interface IdentityCandidate {
  requisitionId?: string | null;
  employerJobId?: string | null;
  canonicalAtsUrl?: string | null;
  postingUrl?: string | null;
  employerId: string;
  title: string;
  location?: string[];
}

export interface ResolvedIdentity {
  identifier: string;
  source: IdentitySource;
  /** false -> raise an identity-uncertain approval instead of applying. */
  reliable: boolean;
}

export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  const drop = [...u.searchParams.keys()].filter(
    (k) => k.startsWith('utm_') || ['src', 'ref', 'source', 'gh_src'].includes(k),
  );
  drop.forEach((k) => u.searchParams.delete(k));
  u.searchParams.sort();
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

/** Fallback ladder from plan section 6. Never guesses past the last rung. */
export function resolveIdentity(c: IdentityCandidate): ResolvedIdentity {
  if (c.requisitionId?.trim())
    return { identifier: c.requisitionId.trim(), source: 'requisition_id', reliable: true };
  if (c.employerJobId?.trim())
    return { identifier: c.employerJobId.trim(), source: 'employer_job_id', reliable: true };
  if (c.canonicalAtsUrl?.trim())
    return {
      identifier: normalizeUrl(c.canonicalAtsUrl),
      source: 'canonical_ats_url',
      reliable: true,
    };
  if (c.postingUrl?.trim())
    return {
      identifier: normalizeUrl(c.postingUrl),
      source: 'normalized_posting_url',
      reliable: true,
    };
  const fp = createHash('sha256')
    .update([c.employerId, c.title, (c.location ?? []).join('|')].join('::').toLowerCase())
    .digest('hex')
    .slice(0, 32);
  return { identifier: fp, source: 'composite_fingerprint', reliable: false };
}

/** Grouping only. MUST NOT be used to suppress a different requisition. */
export function jobFamilyHash(employerId: string, normalizedTitle: string, jdHash: string): string {
  return createHash('sha256')
    .update([employerId, normalizedTitle, jdHash.slice(0, 12)].join('::').toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

export function jdHash(jdText: string): string {
  return createHash('sha256')
    .update(jdText.replace(/\s+/g, ' ').trim().toLowerCase())
    .digest('hex');
}
