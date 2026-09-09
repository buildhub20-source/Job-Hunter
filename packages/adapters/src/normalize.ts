import type { RawPosting } from './types.js';

/** Pure text normalisation. No network, no dependencies — all of it is testable offline. */

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/gi, "&");
}

export function stripHtml(html: string): string {
  // Greenhouse returns its HTML escaped once, so entities are decoded before tags
  // are stripped, then again for anything that was escaped twice.
  let s = decodeEntities(html);
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drops the decoration ATS titles collect, so the same role groups across boards. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[-–—|,/]+/g, ' ')
    .replace(/\b(remote|hybrid|onsite|on-site|full[- ]?time|part[- ]?time|contract|intern(ship)?)\b/g, ' ')
    .replace(/\b(india|bengaluru|bangalore|chennai|hyderabad|pune|mumbai|delhi|noida|gurgaon|coimbatore|usa|us|uk)\b/g, ' ')
    .replace(/\s(i{1,3}|iv|v)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SENIOR_WORDS = ['senior', 'sr.', 'sr ', 'staff', 'principal', 'lead', 'manager', 'director', 'architect', 'head of', 'vp '];
export function looksSenior(title: string): boolean {
  const t = ` ${title.toLowerCase()} `;
  return SENIOR_WORDS.some((w) => t.includes(w));
}

const INTERN_WORDS = ['intern', 'internship', 'trainee', 'apprentice', 'co-op', 'returnship'];
export function looksIntern(title: string): boolean {
  const t = title.toLowerCase();
  return INTERN_WORDS.some((w) => t.includes(w));
}

export interface ParsedLocation {
  raw: string;
  parts: string[];
  country: string | null;
  isIndia: boolean;
  isRemote: boolean;
}

const INDIA_CITIES = [
  'bengaluru', 'bangalore', 'chennai', 'hyderabad', 'pune', 'mumbai', 'delhi',
  'noida', 'gurgaon', 'gurugram', 'coimbatore', 'kochi', 'ahmedabad', 'kolkata', 'trivandrum', 'madurai',
];

export function parseLocation(raw: string, workplaceType?: string | null): ParsedLocation {
  const text = (raw ?? '').trim();
  const lower = text.toLowerCase();
  const parts = text.split(/[,;/|]+/).map((p) => p.trim()).filter(Boolean);
  const isRemote = /\bremote\b|\banywhere\b|\bwork from home\b/.test(lower)
    || (workplaceType ?? '').toLowerCase() === 'remote';
  const isIndia = /\bindia\b|\bind\b/.test(lower) || INDIA_CITIES.some((c) => lower.includes(c));
  let country: string | null = null;
  if (isIndia) country = 'India';
  else if (/\b(usa|united states|u\.s\.)\b/.test(lower)) country = 'United States';
  else if (/\b(uk|united kingdom|london)\b/.test(lower)) country = 'United Kingdom';
  return { raw: text, parts, country, isIndia, isRemote };
}

export type RemoteType = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export function parseRemoteType(locationText: string, workplaceType: string | null): RemoteType {
  const w = (workplaceType ?? '').toLowerCase();
  if (w === 'remote') return 'remote';
  if (w === 'hybrid') return 'hybrid';
  if (w === 'onsite' || w === 'on-site') return 'onsite';
  const l = locationText.toLowerCase();
  if (/\bhybrid\b/.test(l)) return 'hybrid';
  if (/\bremote\b|\banywhere\b/.test(l)) return 'remote';
  if (l.trim()) return 'onsite';
  return 'unknown';
}

export interface ExperienceRange { min: number | null; max: number | null }

/**
 * Pulls a years-of-experience range out of JD prose.
 * Returns nulls rather than guessing — an unparsed JD must not look like "0 years".
 */
export function parseExperience(text: string): ExperienceRange {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const range = /(\d{1,2})\s*(?:\+)?\s*(?:-|–|to)\s*(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)/.exec(t);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };

  const atLeast = /(?:minimum|min\.?|at least|over|more than)\s*(?:of\s*)?(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)/.exec(t);
  if (atLeast) return { min: Number(atLeast[1]), max: null };

  const plus = /(\d{1,2})\s*\+\s*(?:years?|yrs?)/.exec(t);
  if (plus) return { min: Number(plus[1]), max: null };

  const upTo = /(?:up to|less than|under|maximum|max\.?)\s*(\d{1,2})\s*(?:years?|yrs?)/.exec(t);
  if (upTo) return { min: null, max: Number(upTo[1]) };

  const plain = /(\d{1,2})\s*(?:years?|yrs?)\s*(?:of\s*)?(?:relevant\s*|professional\s*|hands[- ]on\s*)?experience/.exec(t);
  if (plain) return { min: Number(plain[1]), max: null };

  return { min: null, max: null };
}

const SKILL_TERMS = [
  'c#', '.net', '.net core', 'asp.net', 'java', 'spring boot', 'spring', 'node.js', 'nodejs', 'express',
  'react', 'redux', 'typescript', 'javascript', 'python', 'go', 'golang', 'kotlin',
  'aws', 'lambda', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform',
  'postgresql', 'postgres', 'sql server', 'mysql', 'mongodb', 'redis', 'elasticsearch',
  'microservices', 'rest', 'graphql', 'grpc', 'kafka', 'rabbitmq',
  'llm', 'rag', 'openai', 'langchain', 'pgvector', 'embeddings', 'ai agent',
];

export function extractSkills(text: string): string[] {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const found = SKILL_TERMS.filter((s) => t.includes(` ${s} `) || t.includes(`${s},`) || t.includes(`${s}.`));
  // Drop terms fully contained in a longer match, so ".net core" wins over ".net".
  return found.filter((s) => !found.some((o) => o !== s && o.includes(s))).sort();
}

/** Compensation, only when the posting actually discloses it. Never inferred. */
export function parseCompensation(text: string): { min: number | null; max: number | null; currency: string | null } {
  const t = text.replace(/,/g, '').toLowerCase();
  const lpa = /(?:₹|inr|rs\.?)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:-|–|to)\s*(\d{1,3}(?:\.\d+)?)\s*(?:lpa|lakhs?\s*(?:per annum|pa)?)/.exec(t);
  if (lpa) return { min: Number(lpa[1]) * 100000, max: Number(lpa[2]) * 100000, currency: 'INR' };
  const lpaSingle = /(?:₹|inr|rs\.?)\s*(\d{1,3}(?:\.\d+)?)\s*(?:lpa|lakhs?)/.exec(t);
  if (lpaSingle) return { min: Number(lpaSingle[1]) * 100000, max: null, currency: 'INR' };
  return { min: null, max: null, currency: null };
}

export function summarize(p: RawPosting): string {
  return `${p.title} @ ${p.locationText || 'unspecified'}`;
}
