import { callClaude } from './llm.js';

/**
 * Answers for open-ended questions — "What does 'The Best Team Wins' mean to you?",
 * "Why this role?" — written to move the application forward, and held to Vinoth's
 * real record. Persuasive framing is the job; invented experience is not (D20): a
 * claim he can't back up in the interview costs more than a plainer answer.
 */

export interface WriteInput {
  question: string;
  company: string;
  role: string;
  /** Text of the job posting page, for what this company says it values. */
  posting: string;
  facts: Map<string, string>;
}

const CANDIDATE_KEYS: Array<[string, string]> = [
  ['full_name', 'Name'],
  ['current_title', 'Current title'],
  ['current_employer', 'Current employer'],
  ['total_experience_years', 'Years of experience'],
  ['current_city', 'City'],
  ['primary_stack', 'Primary stack'],
  ['secondary_skills', 'Also works with'],
  ['databases', 'Databases'],
  ['highest_qualification', 'Degree'],
  ['degree_branch', 'Branch'],
  ['university', 'College'],
  ['graduation_year', 'Graduated'],
  ['resume_highlights', 'Record (from the resume)'],
];

/** The shared context: who, for what, the rules, and the material. Every prompt ends with its own task. */
function context(input: WriteInput): string[] {
  const candidate = CANDIDATE_KEYS
    .map(([key, label]) => (input.facts.get(key) ? `${label}: ${input.facts.get(key)}` : null))
    .filter(Boolean) as string[];

  return [
    `This is for Vinoth's application for ${input.role} at ${input.company}. It is submitted as his own.`,
    '',
    'AIM: make a recruiter want to move him to the next round. Be specific to this company and role,',
    'confident and warm. Connect what the company says it values to something he has actually done.',
    'Avoid clichés ("passionate", "dynamic", "synergy", "I believe that") and flattery.',
    '',
    'TRUTH RULES — these are not negotiable:',
    '- Any experience, project, number, tool or result mentioned must appear in CANDIDATE below.',
    '- Never invent employers, metrics, years, certifications, leadership roles or events.',
    '- Views and values are his to hold; claimed experience must come from CANDIDATE.',
    '- Only say things about the company that POSTING states.',
    '- If the question wants a fact CANDIDATE does not have, work around it instead of inventing it.',
    '',
    'CANDIDATE:',
    ...candidate,
    '',
    'POSTING:',
    input.posting.slice(0, 6000),
  ];
}

export function buildPrompt(input: WriteInput): string {
  return [
    ...context(input),
    '',
    'TASK: write his answer to the question below.',
    'FORMAT: first person, plain text, no markdown, no headings, no surrounding quotes.',
    '60–120 words unless the question clearly wants something shorter.',
    '',
    'QUESTION:',
    input.question,
  ].join('\n');
}

export function buildChoicePrompt(input: WriteInput & { options: string[]; knownAnswer?: string }): string {
  const task = input.knownAnswer
    ? [
        `TASK: his own answer to this dropdown is "${input.knownAnswer}", but the options word it differently.`,
        'Choose the option that means the same thing. If none does, answer 0 — never pick something else.',
      ]
    : [
        'TASK: this question is a dropdown. Choose the option that best serves the AIM without breaking a',
        'TRUTH RULE. If an option lets him write his own answer next (for example one ending in "..."),',
        'prefer it — a follow-up box is filled separately. If every option would claim something CANDIDATE',
        'does not support, answer 0.',
      ];
  return [
    ...context(input),
    '',
    ...task,
    '',
    'OPTIONS (answer with the number):',
    ...input.options.map((o, i) => `${i + 1}. ${o}`),
    '',
    'QUESTION:',
    input.question,
  ].join('\n');
}

/** The option to pick, exactly as listed, or null to leave it unanswered. */
export async function chooseOption(
  input: WriteInput & { options: string[]; knownAnswer?: string },
): Promise<string | null> {
  // A number, not the option's text: the model tends to retype quotes and ellipses
  // ("…" for "..."), and an almost-matching string can't be selected.
  const out = (await callClaude(buildChoicePrompt(input), {
    jsonSchema: {
      type: 'object',
      properties: { option: { type: 'integer' } },
      required: ['option'],
    },
    maxBudgetUsd: 0.2,
  })) as { option?: number };
  const n = out.option ?? 0;
  return n >= 1 && n <= input.options.length ? input.options[n - 1]! : null;
}

export async function writeAnswer(input: WriteInput): Promise<string> {
  const out = (await callClaude(buildPrompt(input), {
    jsonSchema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
    maxBudgetUsd: 0.3,
  })) as { answer?: string };
  const answer = unwrapQuotes((out.answer ?? '').trim());
  if (!answer) throw new Error('the model returned an empty answer');
  return answer;
}

/**
 * Remove quotes only when they wrap the whole answer. Stripping a quote at either end
 * broke an answer that merely opens with a quoted phrase — '"The Best Team Wins" means…'
 * lost its opening quote.
 */
export function unwrapQuotes(text: string): string {
  const m = /^["“]([^"“”]*)["”]$/.exec(text);
  return m ? m[1]!.trim() : text;
}
