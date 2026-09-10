/** Plan section 14. */
export const INBOX_CLASSES = [
  'confirmation', 'rejection', 'interview', 'recruiter', 'assessment',
  'offer', 'action_required', 'job_alert', 'unrelated',
] as const;
export type InboxClass = (typeof INBOX_CLASSES)[number];

export interface RawEmail {
  gmailMessageId: string;
  threadId: string | null;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

export interface ClassificationResult {
  classification: InboxClass;
  confidence: number;
}
