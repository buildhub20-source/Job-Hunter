import type { RawPosting, BoardRef } from '@jobops/adapters';
import {
  parseLocation, parseRemoteType, parseExperience, extractSkills,
  parseCompensation, normalizeTitle,
} from '@jobops/adapters';
import { jdHash, jobFamilyHash, resolveIdentity, type ResolvedIdentity } from '@jobops/shared';

export interface NormalizedPosting {
  jobCard: Record<string, unknown>;
  identity: ResolvedIdentity;
  jdHash: string;
  familyHash: string;
  normalizedTitle: string;
}

/**
 * RawPosting -> JobCard. Pure: no database, no network.
 * Anything the posting does not state stays null. Nothing is inferred into a value.
 */
export function toJobCard(p: RawPosting, board: BoardRef): NormalizedPosting {
  const loc = parseLocation(p.locationText, p.workplaceType);
  const exp = parseExperience(p.descriptionText);
  const comp = parseCompensation(p.descriptionText);
  const hash = jdHash(p.descriptionText || p.title);
  const normalizedTitle = normalizeTitle(p.title);

  const identity = resolveIdentity({
    requisitionId: p.requisitionId,
    employerJobId: p.sourceId,
    canonicalAtsUrl: p.url,
    postingUrl: p.url,
    employerId: board.employerId,
    title: p.title,
    location: loc.parts,
  });

  const jobCard = {
    employer_id: board.employerId,
    company_name: board.displayName,
    title: p.title,
    requisition_id: p.requisitionId,
    ats: board.adapter,
    location: loc.parts,
    remote_type: parseRemoteType(p.locationText, p.workplaceType),
    experience_min: exp.min,
    experience_max: exp.max,
    required_skills: extractSkills(p.descriptionText),
    preferred_skills: [],
    compensation_min: comp.min,
    compensation_max: comp.max,
    currency: comp.currency,
    work_authorization_text: extractWorkAuthText(p.descriptionText),
    source_url: p.url,
    official_url: p.applyUrl ?? p.url,
    job_family_hash: jobFamilyHash(board.employerId, normalizedTitle, hash),
    jd_hash: hash,
    verified_at: null,
    country: loc.country,
    is_remote: loc.isRemote,
    posted_at: p.postedAt,
    team: p.team,
    commitment: p.commitment,
  };

  return { jobCard, identity, jdHash: hash, familyHash: jobFamilyHash(board.employerId, normalizedTitle, hash), normalizedTitle };
}

/** Keeps the sponsorship sentence verbatim so the evaluator can see how it was worded. */
export function extractWorkAuthText(text: string): string | null {
  const m = /[^.\n]*\b(sponsor|sponsorship|work authorization|work authorisation|right to work|visa)\b[^.\n]*\./i.exec(text);
  return m ? m[0].trim().slice(0, 500) : null;
}
