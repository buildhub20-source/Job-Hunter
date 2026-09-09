/** Job lifecycle. Every transition writes an audit row. See plan section 7. */
export const JOB_STATES = [
  'DISCOVERED',
  'VERIFIED',
  'EVALUATED',
  'SKIPPED',
  'WAITING_APPROVAL',
  'APPROVED',
  'QUEUED_TO_APPLY',
  'APPLYING',
  'PARKED',
  'BLOCKED_HUMAN',
  'RETRY_APPROVAL_REQUIRED',
  'FAILED',
  'NEEDS_HUMAN_REVIEW',
  'SUBMITTED_UNVERIFIED',
  'SUBMITTED_VERIFIED',
  'INTERVIEW',
  'REJECTED',
  'OFFER',
  'WITHDRAWN',
] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Legal transitions. Anything not listed here is a bug, not a shortcut. */
export const ALLOWED_TRANSITIONS: Record<JobState, readonly JobState[]> = {
  DISCOVERED: ['VERIFIED', 'SKIPPED'],
  VERIFIED: ['EVALUATED', 'SKIPPED'],
  EVALUATED: ['SKIPPED', 'WAITING_APPROVAL', 'QUEUED_TO_APPLY'],
  SKIPPED: ['EVALUATED'], // re-evaluated after a policy change
  WAITING_APPROVAL: ['APPROVED', 'SKIPPED', 'PARKED'],
  APPROVED: ['QUEUED_TO_APPLY'],
  QUEUED_TO_APPLY: ['APPLYING', 'PARKED'],
  APPLYING: [
    'PARKED',
    'BLOCKED_HUMAN',
    'WAITING_APPROVAL',
    'RETRY_APPROVAL_REQUIRED',
    'FAILED',
    'SUBMITTED_UNVERIFIED',
  ],
  PARKED: ['QUEUED_TO_APPLY', 'APPLYING', 'WITHDRAWN'],
  BLOCKED_HUMAN: ['QUEUED_TO_APPLY', 'APPLYING', 'SUBMITTED_UNVERIFIED', 'WITHDRAWN'],
  RETRY_APPROVAL_REQUIRED: ['APPLYING', 'NEEDS_HUMAN_REVIEW', 'WITHDRAWN'],
  FAILED: ['RETRY_APPROVAL_REQUIRED', 'NEEDS_HUMAN_REVIEW'],
  NEEDS_HUMAN_REVIEW: ['QUEUED_TO_APPLY', 'WITHDRAWN'],
  SUBMITTED_UNVERIFIED: ['SUBMITTED_VERIFIED', 'REJECTED', 'INTERVIEW', 'WITHDRAWN'],
  SUBMITTED_VERIFIED: ['INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN'],
  INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  REJECTED: [],
  OFFER: ['WITHDRAWN'],
  WITHDRAWN: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const TIERS = ['A', 'B', 'C', 'SKIP'] as const;
export type Tier = (typeof TIERS)[number];

export const RUN_MODES = [
  'discovery_only',
  'dry_run',
  'assisted',
  'approval_gated',
  'autonomous',
] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const APPROVAL_TYPES = ['information', 'conflict', 'retry', 'action'] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_SCOPES = ['this_job', 'this_run', 'permanent'] as const;
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];

export const EVIDENCE_LEVELS = ['E0', 'E1', 'E2', 'E3', 'E4'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const FAILURE_CLASSES = [
  'transient_network',
  'ats_server_error',
  'auth_expired',
  'browser_session_failure',
  'validation_failure',
  'missing_information',
  'captcha',
  'adapter_defect',
  'posting_closed',
  'duplicate',
  'unknown',
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const MAX_RETRIES = 3;
