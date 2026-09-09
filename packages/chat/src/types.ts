export type ApprovalType = 'information' | 'conflict' | 'retry' | 'action';
export type ApprovalScope = 'this_job' | 'this_run' | 'permanent';

export interface ApprovalCardInput {
  approvalId: string;
  type: ApprovalType;
  company: string;
  role: string;
  requisitionId: string | null;
  question: string;
  /** What personal.md already holds that is relevant. Shown so the answer is informed. */
  knownFacts: { key: string; value: string }[];
  /** Why the agent cannot answer by itself. */
  blockedReason: string;
  /** Suggested answers. Empty means free text only. */
  choices: string[];
  allowFreeText: boolean;
  /** Scope is not offered for retry/action cards — they are always one-shot. */
  offerScope: boolean;
}

export type NotificationKind =
  | 'captcha' | 'assessment' | 'id_check' | 'auth_expired'
  | 'adapter_broken' | 'retries_exhausted' | 'interview' | 'offer' | 'action_required';

export interface NotificationInput {
  notificationId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Path within the dashboard, e.g. /applications. Turned into a link button. */
  dashboardPath?: string;
  dashboardBaseUrl: string;
}

/** What comes back when the user taps a button or types a reply. */
export interface InboundAnswer {
  approvalId: string;
  answer: string;
  scope: ApprovalScope;
  respondedBy: string;
  messageId?: string;
}

export interface PostResult { messageId: string | null; thread?: string | null }

export interface ChatTransport {
  readonly name: string;
  postApproval(card: ApprovalCardInput): Promise<PostResult>;
  postNotification(n: NotificationInput): Promise<PostResult>;
}
