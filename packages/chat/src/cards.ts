import type { ApprovalCardInput, NotificationInput } from './types.js';

/**
 * Google Chat cards v2. Pure functions, no dependencies, so they are testable
 * without credentials and without a network.
 */

const TYPE_LABEL: Record<string, string> = {
  information: 'Question',
  conflict: 'Conflicting information',
  retry: 'Retry approval',
  action: 'Action needed',
};

export function buildApprovalCard(c: ApprovalCardInput): Record<string, unknown> {
  const header = [c.company, c.role].filter(Boolean).join(' · ');
  const subtitle = c.requisitionId ? `Req ${c.requisitionId}` : 'No requisition id';

  const widgets: Record<string, unknown>[] = [
    { textParagraph: { text: `<b>${escapeHtml(c.question)}</b>` } },
  ];

  if (c.knownFacts.length > 0) {
    widgets.push({
      decoratedText: {
        topLabel: 'What I already know',
        text: c.knownFacts.map((f) => `${f.key}: ${escapeHtml(f.value)}`).join('<br>'),
        wrapText: true,
      },
    });
  }

  widgets.push({
    decoratedText: { topLabel: 'Why I am asking', text: escapeHtml(c.blockedReason), wrapText: true },
  });

  if (c.offerScope) {
    widgets.push({
      selectionInput: {
        name: 'scope',
        label: 'Apply this answer to',
        type: 'RADIO_BUTTON',
        items: [
          { text: 'This job only', value: 'this_job', selected: true },
          { text: 'This run', value: 'this_run', selected: false },
          { text: 'Save permanently to personal.md', value: 'permanent', selected: false },
        ],
      },
    });
  }

  if (c.allowFreeText) {
    widgets.push({
      textInput: { name: 'free_text', label: 'Or type an answer', type: 'SINGLE_LINE' },
    });
  }

  const buttons = c.choices.map((choice) => ({
    text: choice,
    onClick: action('answer', [
      { key: 'approvalId', value: c.approvalId },
      { key: 'answer', value: choice },
    ]),
  }));

  if (c.allowFreeText) {
    buttons.push({
      text: 'Submit typed answer',
      onClick: action('answer_free_text', [{ key: 'approvalId', value: c.approvalId }]),
    });
  }

  buttons.push({
    text: 'Skip this job',
    onClick: action('skip', [{ key: 'approvalId', value: c.approvalId }]),
  });

  widgets.push({ buttonList: { buttons } });

  return {
    cardsV2: [
      {
        cardId: `approval-${c.approvalId}`,
        card: {
          header: { title: header || 'Approval needed', subtitle: `${TYPE_LABEL[c.type] ?? c.type} · ${subtitle}` },
          sections: [{ widgets }],
        },
      },
    ],
  };
}

export function buildNotificationCard(n: NotificationInput): Record<string, unknown> {
  const widgets: Record<string, unknown>[] = [
    { textParagraph: { text: escapeHtml(n.body) } },
  ];
  if (n.dashboardPath) {
    widgets.push({
      buttonList: {
        buttons: [
          {
            text: 'Open dashboard',
            onClick: { openLink: { url: joinUrl(n.dashboardBaseUrl, n.dashboardPath) } },
          },
        ],
      },
    });
  }
  return {
    cardsV2: [
      {
        cardId: `notify-${n.notificationId}`,
        card: {
          header: { title: n.title, subtitle: humanKind(n.kind) },
          sections: [{ widgets }],
        },
      },
    ],
  };
}

function action(fn: string, parameters: { key: string; value: string }[]) {
  return { action: { function: fn, parameters } };
}

export function humanKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
