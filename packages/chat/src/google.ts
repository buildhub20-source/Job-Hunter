import { GoogleAuth } from 'google-auth-library';
import type { ChatTransport, ApprovalCardInput, NotificationInput, PostResult } from './types.js';
import { buildApprovalCard, buildNotificationCard } from './cards.js';

const SCOPE = 'https://www.googleapis.com/auth/chat.bot';

/**
 * Auth is Application Default Credentials with service-account impersonation.
 * There is no key file: iam.disableServiceAccountKeyCreation is enforced on
 * this org. Establish credentials once with:
 *
 *   gcloud auth application-default login \
 *     --impersonate-service-account=jobservice@jobhunter-508210.iam.gserviceaccount.com
 */
export class GoogleChatTransport implements ChatTransport {
  readonly name = 'google_chat';
  private readonly auth = new GoogleAuth({ scopes: [SCOPE] });

  constructor(private readonly spaceId: string) {}

  private async send(body: Record<string, unknown>): Promise<PostResult> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error('no Application Default Credentials - run gcloud auth application-default login with --impersonate-service-account');
    }

    const space = this.spaceId.startsWith('spaces/') ? this.spaceId : `spaces/${this.spaceId}`;
    const res = await fetch(`https://chat.googleapis.com/v1/${space}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`chat post failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { name?: string; thread?: { name?: string } };
    return { messageId: json.name ?? null, thread: json.thread?.name ?? null };
  }

  postApproval(c: ApprovalCardInput): Promise<PostResult> {
    return this.send(buildApprovalCard(c));
  }
  postNotification(n: NotificationInput): Promise<PostResult> {
    return this.send(buildNotificationCard(n));
  }
}