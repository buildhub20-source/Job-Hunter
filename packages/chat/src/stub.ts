import type { ChatTransport, ApprovalCardInput, NotificationInput, PostResult } from './types.js';
import { buildApprovalCard, buildNotificationCard } from './cards.js';

/**
 * Used when no Google Chat credentials are configured. Prints what would have
 * been sent and returns a synthetic message id, so the whole approval flow can be
 * exercised end to end offline. Answers arrive through POST /api/approvals/:id/answer.
 */
export class StubTransport implements ChatTransport {
  readonly name = 'stub';
  constructor(private readonly log: (msg: string) => void = console.log) {}

  async postApproval(c: ApprovalCardInput): Promise<PostResult> {
    this.log(
      [
        '',
        '─── APPROVAL (stub — would go to Google Chat) ───',
        `${c.company} · ${c.role}${c.requisitionId ? ` · req ${c.requisitionId}` : ''}`,
        `Q: ${c.question}`,
        c.knownFacts.length ? `known: ${c.knownFacts.map((f) => `${f.key}=${f.value}`).join(', ')}` : 'known: nothing relevant',
        `why: ${c.blockedReason}`,
        `choices: ${c.choices.join(' | ')}${c.allowFreeText ? ' | (free text)' : ''}`,
        `answer with: curl -XPOST localhost:4000/api/approvals/${c.approvalId}/answer -H 'content-type: application/json' -d '{"answer":"...","scope":"this_job"}'`,
        '────────────────────────────────────────────────',
      ].join('\n'),
    );
    void buildApprovalCard(c); // keep the card builder on the exercised path
    return { messageId: `stub-${c.approvalId}` };
  }

  async postNotification(n: NotificationInput): Promise<PostResult> {
    this.log(`\n[!] ${n.title} — ${n.body}${n.dashboardPath ? ` (${n.dashboardPath})` : ''}\n`);
    void buildNotificationCard(n);
    return { messageId: `stub-${n.notificationId}` };
  }
}
