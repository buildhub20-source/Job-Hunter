import { query, one } from '@jobops/db';
import type { ChatTransport, NotificationKind } from '@jobops/chat';

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body: string;
  applicationId?: string | null;
  dashboardPath?: string;
  severity?: 'normal' | 'high';
}

const DEFAULT_PATH: Record<string, string> = {
  captcha: '/applications',
  assessment: '/applications',
  id_check: '/applications',
  auth_expired: '/adapters',
  adapter_broken: '/adapters',
  retries_exhausted: '/applications',
  interview: '/updates',
  offer: '/updates',
  action_required: '/updates',
};

/**
 * Things you cannot answer in chat — you have to go and do something.
 * Fires the alert and records it; the dashboard shows the unacknowledged ones.
 */
export async function notify(
  transport: ChatTransport,
  input: NotifyInput,
  dashboardBaseUrl = process.env['DASHBOARD_URL'] ?? 'http://localhost:3000',
): Promise<{ notificationId: string }> {
  const path = input.dashboardPath ?? DEFAULT_PATH[input.kind] ?? '/';
  const row = await one<{ id: string }>(
    `INSERT INTO notifications (kind, severity, title, body, dashboard_path, application_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [input.kind, input.severity ?? 'normal', input.title, input.body, path, input.applicationId ?? null],
  );
  if (!row) throw new Error('failed to create notification');

  try {
    await transport.postNotification({
      notificationId: row.id,
      kind: input.kind,
      title: input.title,
      body: input.body,
      dashboardPath: path,
      dashboardBaseUrl,
    });
    await query(`UPDATE notifications SET delivered_at = now() WHERE id = $1`, [row.id]);
  } catch (err) {
    // A failed alert must not kill the run; it stays undelivered and visible on the dashboard.
    console.error('[notify] delivery failed:', err instanceof Error ? err.message : err);
  }

  return { notificationId: row.id };
}

/** Convenience wrappers for the blocks the plan names explicitly. */
export const blocked = {
  captcha: (t: ChatTransport, appId: string, where: string) =>
    notify(t, { kind: 'captcha', title: 'Blocked on CAPTCHA', body: `${where} — I cannot solve this. Open the dashboard and finish it.`, applicationId: appId, severity: 'high' }),
  assessment: (t: ChatTransport, appId: string, where: string, link?: string) =>
    notify(t, { kind: 'assessment', title: 'Assessment required', body: `${where}${link ? ` — ${link}` : ''}`, applicationId: appId, severity: 'high' }),
  idCheck: (t: ChatTransport, appId: string, where: string) =>
    notify(t, { kind: 'id_check', title: 'Identity verification required', body: where, applicationId: appId, severity: 'high' }),
  authExpired: (t: ChatTransport, adapter: string) =>
    notify(t, { kind: 'auth_expired', title: `${adapter}: login expired`, body: 'Sign in again so the adapter can keep working.' }),
  adapterBroken: (t: ChatTransport, adapter: string, error: string) =>
    notify(t, { kind: 'adapter_broken', title: `${adapter} is broken`, body: error }),
  retriesExhausted: (t: ChatTransport, appId: string, where: string) =>
    notify(t, { kind: 'retries_exhausted', title: 'Retries exhausted', body: `${where} — moved to needs human review.`, applicationId: appId, severity: 'high' }),
};
