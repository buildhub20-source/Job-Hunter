/**
 * Form label -> personal.md fact key. Shared by every adapter so a fix lands once.
 *
 * First match wins, so order is everything: specific rules must come before the
 * generic ones that would also match ("Expected CTC" before "CTC", "How did you hear
 * (LinkedIn, website)" before "LinkedIn"). Rules can also be limited to field types —
 * a consent rule must never fire on a text box that happens to say "notice".
 *
 * Synthetic keys:
 *   __first_name / __last_name  derived from full_name by the adapter
 *   __checkbox_confirm          tick a required consent checkbox
 *   __empty_optional            leave blank
 *   __ask                       recognised, but only a human can answer it
 */

type FieldType = string;

interface Rule {
  factKey: string;
  test: (label: string, original: string, ctx: MatchContext) => boolean;
  types?: FieldType[];
}

export interface MatchContext {
  /** The job's Location column. Decides which country a country-less
   * "require sponsorship?" question is really asking about. */
  jobLocation: string;
}

const TEXTUAL = ['text', 'textarea', 'email', 'tel', 'url', 'number', 'select', 'combobox', 'search'];
const SHORT = ['text', 'email', 'tel', 'url', 'number', 'select', 'combobox', 'search'];

const INDIA_PLACES = [
  'india', 'bengaluru', 'bangalore', 'chennai', 'hyderabad', 'pune', 'mumbai', 'delhi',
  'noida', 'gurgaon', 'gurugram', 'coimbatore', 'kochi', 'ahmedabad', 'kolkata',
  'trivandrum', 'thiruvananthapuram', 'madurai', 'jaipur', 'chandigarh', 'indore',
];

export function isIndiaLocation(location: string): boolean {
  const l = location.toLowerCase();
  return INDIA_PLACES.some((p) => l.includes(p));
}

/** Case-sensitive on purpose: "US" is the country, "us" is usually "work for us". */
function mentionsUS(original: string): boolean {
  return /\bU\.?S\.?A?\b/.test(original) || /united states|america\b/i.test(original);
}

const re = (pattern: RegExp) => (label: string) => pattern.test(label);

const RULES: Rule[] = [
  { factKey: '__checkbox_confirm', types: ['checkbox'], test: re(/confirm|privacy|consent|truth|accura|acknowledg|terms|agree/) },
  // Some forms render the same attestation as a Yes/No dropdown. Stricter wording than
  // the checkbox rule, since a dropdown saying "confirm" could be asking anything.
  {
    factKey: '__checkbox_confirm',
    types: ['select', 'combobox'],
    test: re(/\bi (?:confirm|agree|acknowledge|consent|certify|attest)|privacy (?:notice|policy)|terms (?:and|&) conditions|true and (?:correct|accurate)/),
  },

  { factKey: 'preferred_name', test: re(/preferred.?(?:first.?)?name|nickname|name.{0,25}prefer|go by/) },
  { factKey: 'gender', test: re(/\bgender\b/) },
  // Voluntary self-identification beyond gender: no fact, and not ours to answer or
  // guess. It doesn't move an application forward either way.
  { factKey: '__empty_optional', test: re(/hispanic|latin[oax]|\brace\b|ethnicit|veteran|disabilit|sexual orientation|transgender/) },
  { factKey: '__first_name', test: re(/first.?name|given.?name/) },
  { factKey: '__last_name', test: re(/last.?name|surname|family.?name/) },
  { factKey: 'full_name', test: re(/full.?name|your.?name|^\s*name\s*\*?\s*$/) },
  { factKey: 'primary_email', test: re(/e-?mail/) },
  { factKey: 'phone', test: re(/phone|mobile/) },

  // Before the profile-URL rules: its label usually lists "LinkedIn, website, referral".
  { factKey: 'how_did_you_hear', test: re(/how.?did.?you.?(?:hear|find|learn|come across)/) },

  { factKey: 'linkedin_url', test: re(/linkedin/) },
  { factKey: 'github_url', test: re(/github/) },
  { factKey: 'leetcode_url', test: re(/leetcode/) },
  { factKey: 'portfolio_url', test: re(/portfolio|personal.?(?:site|website|url)|^\s*website\b/) },

  // Work authorisation before anything with a looser pattern ("state your visa status",
  // "why you require sponsorship to work in the US"). A question that names the US is
  // answered with the US facts; one that names no country is answered with the India
  // facts only for an India-located role — anywhere else a human decides.
  {
    factKey: 'authorized_to_work_us',
    test: (l, o) => /authori[sz]ed|eligible|legally|right to work|work authori[sz]ation/.test(l) && mentionsUS(o),
  },
  { factKey: 'requires_sponsorship_us', test: (l, o) => /sponsor/.test(l) && mentionsUS(o) },
  {
    factKey: 'authorized_to_work_india',
    test: (l, _o, ctx) =>
      /authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work|legally (?:authori[sz]ed|eligible)/.test(l) &&
      isIndiaLocation(ctx.jobLocation),
  },
  {
    factKey: 'requires_sponsorship_india',
    test: (l, _o, ctx) => /sponsor|work visa|immigration/.test(l) && isIndiaLocation(ctx.jobLocation),
  },
  { factKey: '__ask', test: re(/authori[sz]ed to work|work authori[sz]ation|right to work|eligible to work|sponsor|work visa|immigration/) },

  // An approved answer, so it must beat the "are you willing to…" rule below.
  { factKey: 'willing_to_relocate', test: re(/relocat/) },

  // Commitments only Vinoth can make: restrictive agreements, past employment with
  // this employer, "are you willing to…". Recognised so they're asked, never assumed —
  // and ahead of the employer rule, since "agreements with your current employer" names one.
  { factKey: '__ask', test: re(/subject.?to.?.*?(?:agreement|restriction)|non.?compete|post.?employ|previously.?worked|worked.?(?:at|for)|consulted.?(?:at|for)/) },
  { factKey: '__ask', test: re(/comfortable|are.?you.?(?:ok|okay|open|willing|happy|fine)/) },

  { factKey: 'hard_technical_problem_essay', types: ['textarea'], test: re(/technical (?:problem|challenge)|complex technical|hardest (?:problem|bug)/) },
  { factKey: 'why_speechify_essay', types: ['textarea'], test: re(/why.*speechify/) },
  // No generic "why us" fact: the same paragraph on every application reads as boilerplate.
  // Unmatched, these textareas get an answer written for the company (D20).

  // Expected before current before bare: a bare "Salary" is ambiguous, so it asks.
  { factKey: 'expected_ctc', types: SHORT, test: re(/(?:expect|desired|require).{0,20}(?:salary|\bctc\b|compensation|\bpay\b)|(?:salary|\bctc\b|compensation).{0,20}(?:expect|desired|requirement)/) },
  { factKey: 'current_ctc', types: SHORT, test: re(/(?:current|present|last drawn).{0,20}(?:salary|\bctc\b|compensation|\bpay\b)/) },
  { factKey: '__ask', test: re(/salary|\bctc\b|compensation/) },

  { factKey: 'notice_period_days', test: re(/notice.?period/) },
  // Needs "years": "Do you have experience with Go?" or "Describe your experience…" is
  // not asking for a number.
  { factKey: 'total_experience_years', types: SHORT, test: re(/(?:years?|yrs).{0,25}experience|experience.{0,25}(?:years?|yrs)|total.?exp/) },

  // travel_percentage_ok is a placeholder (source=default), not Vinoth's answer — ask.
  { factKey: '__ask', test: re(/travel/) },

  { factKey: 'graduation_year', test: re(/end.?date.?year|graduation.?year|year.?of.?graduation|graduat\w* (?:year|date)/) },
  { factKey: 'education_start', test: re(/start.?date.?year|education.?start/) },
  { factKey: 'university', test: re(/university|college|school/) },
  { factKey: 'degree_branch', test: re(/discipline|major|field.?of.?study|branch|specialization/) },
  { factKey: 'highest_qualification', test: re(/degree|qualification/) },
  { factKey: 'cgpa_or_percentage', test: re(/\bc?gpa\b|grade point|academic (?:score|percentage)/) },

  { factKey: 'current_employer', types: TEXTUAL, test: re(/(?:current|most.?recent|present|previous).?(?:company|employer|organi[sz]ation)|^\s*(?:company|employer)(?: name)?\s*\*?\s*$/) },
  { factKey: 'current_title', types: TEXTUAL, test: re(/(?:current|most.?recent|present).{0,12}(?:title|role|position|designation)|^\s*job.?title/) },

  { factKey: 'current_country', test: re(/where.?are.?you.?(?:located|based)|country.?of.?residence|current.?country|^\s*country\b/) },
  { factKey: 'current_city', test: re(/\bcity\b/) },
  { factKey: 'current_state', test: re(/^\s*(?:state|province)\b|state\s*(?:\/|or)\s*province|current state|state of residence/) },
  { factKey: 'current_country', test: re(/^\s*(?:current\s+)?location\b/) },

  { factKey: 'earliest_start_date', test: re(/start.?date|earliest.?start|availability|preferred.?start|when can you (?:start|join)/) },

  { factKey: '__empty_optional', test: re(/accessib|accommodation|adjustment/) },
];

/** The fact key for a form field, or null if no rule recognises it. */
export function matchFact(label: string, type: string, ctx: MatchContext): string | null {
  const lower = label.toLowerCase();
  for (const rule of RULES) {
    if (rule.types && !rule.types.includes(type)) continue;
    if (rule.test(lower, label, ctx)) return rule.factKey;
  }
  return null;
}
