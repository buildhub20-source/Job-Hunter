import type { InboundAnswer, ApprovalScope } from './types.js';

const SCOPES: ApprovalScope[] = ['this_job', 'this_run', 'permanent'];

interface ChatEvent {
  type?: string;
  message?: { name?: string; text?: string; thread?: { name?: string } };
  user?: { displayName?: string; email?: string };
  common?: {
    invokedFunction?: string;
    parameters?: Record<string, string>;
    formInputs?: Record<string, { stringInputs?: { value?: string[] } }>;
  };
}

function formValue(e: ChatEvent, name: string): string | undefined {
  return e.common?.formInputs?.[name]?.stringInputs?.value?.[0];
}

/**
 * Turn a Chat interaction into an answer, or null when the event is not one.
 * Deliberately strict: an event we do not recognise produces nothing rather than
 * a guessed answer.
 */
export function parseInteraction(event: unknown): InboundAnswer | null {
  const e = event as ChatEvent;
  if (!e || typeof e !== 'object') return null;
  if (e.type !== 'CARD_CLICKED') return null;

  const fn = e.common?.invokedFunction;
  const approvalId = e.common?.parameters?.['approvalId'];
  if (!approvalId) return null;

  const rawScope = formValue(e, 'scope');
  const scope: ApprovalScope = SCOPES.includes(rawScope as ApprovalScope)
    ? (rawScope as ApprovalScope)
    : 'this_job'; // narrowest scope wins when unspecified

  const respondedBy = e.user?.email ?? e.user?.displayName ?? 'unknown';
  const messageId = e.message?.name;

  if (fn === 'answer') {
    const answer = e.common?.parameters?.['answer'];
    if (!answer) return null;
    return { approvalId, answer, scope, respondedBy, messageId };
  }

  if (fn === 'answer_free_text') {
    const answer = formValue(e, 'free_text')?.trim();
    if (!answer) return null;
    return { approvalId, answer, scope, respondedBy, messageId };
  }

  if (fn === 'skip') {
    return { approvalId, answer: '__SKIP__', scope: 'this_job', respondedBy, messageId };
  }

  return null;
}

export const SKIP_ANSWER = '__SKIP__';
