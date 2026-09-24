/**
 * @vitest-environment happy-dom
 */
import { getOrCreateI18n } from '@affine/i18n';
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import {
  type BlockerSuggestionConfirmation,
  type StreamObject,
  StreamObjectSchema,
  workOrderDraftFromToolResult,
  type WorkOrderProposalActions,
} from '../ai-chat-messages/type';
import {
  blockerSuggestionFromToolResult,
  ChatContentStreamObjects,
  isLegacyResourceToolName,
  officeToolResultView,
} from './stream-objects';

const blockerSuggestion = {
  aiSuggestionId: 'b3b94f5e-936d-4d0e-875a-a0475f612f80',
  confirmationProof: 'hidden-signed-confirmation-proof',
  projectId: 'project-1',
  title: '等待供应商提供最终交付文件'.repeat(12),
  type: 'wait_file',
  waitingOn: '供应商客户成功团队'.repeat(12),
  dueAt: '2026-09-05T17:00:00.000Z',
  origin: 'ai_suggested',
  confirmationRequired: true,
} as const;

const labels: BlockerSuggestionConfirmation['labels'] = {
  title: 'Suggested blocker',
  type: 'Type',
  waitingOn: 'Waiting on',
  dueAt: 'Due date',
  create: 'Create blocker',
  creating: 'Creating blocker...',
  created: 'Blocker created',
  failed: 'The blocker was not created. Try again.',
  typeNames: {
    wait_reply: 'Reply',
    wait_file: 'File',
    wait_decision: 'Decision',
    custom: 'Other',
  },
};

const renderBlockerSuggestion = async (
  confirmation?: BlockerSuggestionConfirmation
) => {
  const instance = Object.create(ChatContentStreamObjects.prototype) as
    | ChatContentStreamObjects
    | Record<string, unknown>;
  Object.defineProperties(instance, {
    answer: {
      configurable: true,
      writable: true,
      value: [
        {
          type: 'tool-result',
          toolCallId: 'tool-call-1',
          toolName: 'blocker_suggest',
          args: {},
          result: blockerSuggestion,
        },
      ],
    },
    blockerSuggestionConfirmation: {
      configurable: true,
      writable: true,
      value: confirmation,
    },
    pendingBlockerSuggestions: {
      configurable: true,
      writable: true,
      value: new Set<string>(),
    },
    confirmedBlockerSuggestions: {
      configurable: true,
      writable: true,
      value: new Set<string>(),
    },
    blockerSuggestionErrors: {
      configurable: true,
      writable: true,
      value: new Set<string>(),
    },
    width: {
      configurable: true,
      writable: true,
      value: undefined,
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const rerender = () => {
    render(
      (
        ChatContentStreamObjects.prototype as unknown as { render(): unknown }
      ).render.call(instance) as never,
      container
    );
  };
  rerender();
  return { container, instance, rerender };
};

const workOrderDraft = {
  kind: 'work_order_draft',
  draftId: 'f33848cd-2fd4-4428-b89f-f48781f83340',
  sourceSessionId: 'b792a831-3d83-4892-a9ce-c143d0182446',
  origin: 'ai_generated',
  confirmationRequired: true,
  recipients: [
    {
      recipient: {
        id: 'recipient-1',
        name: 'Alex',
        email: 'alex@example.com',
      },
      title: 'Provide final deck',
      purpose: 'Complete the review',
      relationKind: 'original',
      relatedWorkOrderId: null,
      requirements: [
        {
          kind: 'file',
          title: 'Slide deck',
          instructions: 'Send the approved PPTX',
          required: true,
          acceptedMimeTypes: [
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          ],
          minCount: 1,
          maxCount: 1,
        },
      ],
    },
  ],
} as const;

const proposalLabels: WorkOrderProposalActions['labels'] = {
  title: 'Review work-order draft',
  notice: 'Only you can see this draft.',
  sourceProject: 'Source project',
  sourceProjectDisclosure: 'The recipient will see the project name.',
  recipient: 'Recipient',
  requirements: 'Requirements',
  required: 'Required',
  optional: 'Optional',
  file: 'File',
  text: 'Text',
  formats: 'Accepted formats',
  count: 'Quantity',
  relation: 'Relation',
  relationNames: {
    original: 'New work order',
    supplement: 'Supplement',
    replacement: 'Replacement',
  },
  feedback: 'Changes to request',
  send: 'Send work order',
  sending: 'Sending...',
  sent: 'Sent',
  revise: 'Request changes',
  revising: 'Sending feedback...',
  revisionRequested: 'Asked Agent to revise',
  cancel: 'Cancel sending',
  cancelled: 'Sending cancelled',
  failed: 'This action failed. Try again.',
};

const renderWorkOrderDraft = (
  actions?: WorkOrderProposalActions,
  answer?: StreamObject[]
) => {
  const instance = Object.create(ChatContentStreamObjects.prototype) as
    | ChatContentStreamObjects
    | Record<string, unknown>;
  for (const [key, value] of Object.entries({
    answer: answer ?? [
      {
        type: 'tool-result',
        toolCallId: 'draft-call',
        toolName: 'work_order_draft',
        args: {},
        result: workOrderDraft,
      },
    ],
    workOrderProposalActions: actions,
    workOrderFeedback: new Map<string, string>(),
    pendingWorkOrderDrafts: new Map<string, 'send' | 'revise'>(),
    workOrderDecisions: new Map<string, 'sent' | 'revised' | 'cancelled'>(),
    workOrderDraftErrors: new Map<string, string>(),
    width: undefined,
  })) {
    Object.defineProperty(instance, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const container = document.createElement('div');
  document.body.append(container);
  const rerender = () =>
    render(
      (
        ChatContentStreamObjects.prototype as unknown as { render(): unknown }
      ).render.call(instance) as never,
      container
    );
  rerender();
  return { container, rerender };
};

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});
beforeAll(async () => {
  await getOrCreateI18n().changeLanguage('en');
});

describe('Agent work-order proposal', () => {
  test('shows one card when the Agent returns the same draft twice', () => {
    const { container } = renderWorkOrderDraft(
      {
        onSend: vi.fn(async () => {}),
        onRequestRevision: vi.fn(async () => {}),
        labels: proposalLabels,
      },
      ['first', 'second'].flatMap(toolCallId => [
        {
          type: 'tool-call' as const,
          toolCallId,
          toolName: 'work_order_draft',
          args: {},
        },
        {
          type: 'tool-result' as const,
          toolCallId,
          toolName: 'work_order_draft',
          args: {},
          result: {
            ...workOrderDraft,
            draftId:
              toolCallId === 'first'
                ? workOrderDraft.draftId
                : '2902cb69-148b-4a29-89c0-d4fbe947dc80',
          },
        },
      ])
    );
    expect(container.querySelectorAll('.work-order-proposal')).toHaveLength(1);
    expect(container.querySelectorAll('tool-call-card')).toHaveLength(1);
  });

  test('accepts only a validated Agent draft', () => {
    expect(
      workOrderDraftFromToolResult('work_order_draft', workOrderDraft)?.draftId
    ).toBe(workOrderDraft.draftId);
    expect(
      workOrderDraftFromToolResult('work_order_draft', {
        ...workOrderDraft,
        confirmationRequired: false,
      })
    ).toBeNull();
    expect(
      workOrderDraftFromToolResult('work_order_draft', {
        ...workOrderDraft,
        recipients: [],
      })
    ).toBeNull();
    expect(
      workOrderDraftFromToolResult('work_order_draft', workOrderDraft, true)
    ).toBeNull();
  });

  test('shows a conversation card and sends only after a user click', async () => {
    const onSend = vi.fn(async () => {});
    const { container, rerender } = renderWorkOrderDraft({
      onSend,
      onRequestRevision: vi.fn(async () => {}),
      labels: proposalLabels,
    });
    expect(container.querySelector('.work-order-proposal')).not.toBeNull();
    expect(container.textContent).toContain('Provide final deck');
    expect(container.textContent).toContain('Send the approved PPTX');
    expect(container.textContent).not.toContain(workOrderDraft.draftId);
    expect(onSend).not.toHaveBeenCalled();

    const send = [...container.querySelectorAll('button')].find(button =>
      button.textContent?.includes(proposalLabels.send)
    );
    send?.click();
    await vi.waitFor(() => {
      rerender();
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(send?.textContent?.trim()).toBe(proposalLabels.sent);
    });
    send?.click();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test('keeps a specific send failure visible on the draft card', async () => {
    const { container, rerender } = renderWorkOrderDraft({
      onSend: vi.fn(async () => {
        throw new Error('disabled');
      }),
      onRequestRevision: vi.fn(async () => {}),
      errorMessage: () =>
        'The administrator has disabled personal work orders.',
      labels: proposalLabels,
    });
    const send = [...container.querySelectorAll('button')].find(button =>
      button.textContent?.includes(proposalLabels.send)
    );
    send?.click();
    await vi.waitFor(() => {
      rerender();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'The administrator has disabled personal work orders.'
      );
    });
  });

  test('sends feedback to the Agent without dispatching the draft', async () => {
    const onSend = vi.fn(async () => {});
    const onRequestRevision = vi.fn(async () => {});
    const { container, rerender } = renderWorkOrderDraft({
      onSend,
      onRequestRevision,
      labels: proposalLabels,
    });
    const feedback = container.querySelector('textarea');
    expect(feedback).not.toBeNull();
    if (!feedback) return;
    feedback.value = '  Add a review deadline  ';
    feedback.dispatchEvent(new Event('input', { bubbles: true }));
    rerender();
    const revise = [...container.querySelectorAll('button')].find(button =>
      button.textContent?.includes(proposalLabels.revise)
    );
    revise?.click();
    await vi.waitFor(() => {
      rerender();
      expect(onRequestRevision).toHaveBeenCalledWith(
        expect.objectContaining({ draftId: workOrderDraft.draftId }),
        'Add a review deadline'
      );
      expect(revise?.textContent?.trim()).toBe(
        proposalLabels.revisionRequested
      );
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  test('cancels a proposal and keeps it cancelled after the card remounts', () => {
    const onSend = vi.fn(async () => {});
    const onRequestRevision = vi.fn(async () => {});
    const actions = { onSend, onRequestRevision, labels: proposalLabels };
    const { container, rerender } = renderWorkOrderDraft(actions);
    const cancel = [...container.querySelectorAll('button')].find(button =>
      button.textContent?.includes(proposalLabels.cancel)
    );
    cancel?.click();
    rerender();
    expect(cancel?.textContent?.trim()).toBe(proposalLabels.cancelled);
    expect(onSend).not.toHaveBeenCalled();

    const remounted = renderWorkOrderDraft(actions).container;
    const buttons = [...remounted.querySelectorAll('button')];
    expect(buttons.every(button => button.disabled)).toBe(true);
    buttons.forEach(button => button.click());
    expect(onSend).not.toHaveBeenCalled();
    expect(onRequestRevision).not.toHaveBeenCalled();
  });
});

describe('Office tool result presentation', () => {
  test('restored read validation errors without an isError flag never claim success', () => {
    expect(
      officeToolResultView('workspace_office_read', {
        message: 'selector JSON must match the required Office schema',
      })
    ).toEqual({
      status: 'error',
      name: 'The file could not be read. Reopen it and try again.',
    });
    expect(officeToolResultView('workspace_office_read', {})).toEqual({
      status: 'error',
      name: 'The file could not be read. Reopen it and try again.',
    });
  });
  test('states that an approval request has not created a revision', () => {
    const view = officeToolResultView('workspace_office_command_request', {
      success: true,
      approvalRequired: true,
      taskId: 'task-1',
      commandCount: 1,
      previewSummary: { operation: 'office.document.text.format' },
    });

    expect(view.status).toBe('success');
    if (view.status !== 'success') return;
    expect(view.name).toBe('Office change awaiting approval');
    expect(view.results[0]?.title).toBe('Approval required');
    expect(view.results[0]?.content).toContain('The file has not changed');
    expect(view.results[0]?.content).not.toMatch(
      /completed|modification done/i
    );
  });

  test('renders bounded read and persisted batch evidence without completion claims', () => {
    const read = officeToolResultView('workspace_office_read', {
      revisionId: 'revision-4',
      sequence: 4,
      truncated: false,
    });
    expect(read).toEqual({
      status: 'success',
      kind: 'read',
      name: 'Read revision 4',
      results: [
        {
          title: 'Revision 4',
          content: 'The file was read successfully.',
        },
      ],
    });

    const batch = officeToolResultView(
      'workspace_office_command_batch_request',
      {
        success: true,
        approvalRequired: false,
        taskId: 'task-2',
        commandCount: 3,
        previewSummary: { operation: 'office.command.batch' },
      }
    );
    expect(batch.status).toBe('success');
    if (batch.status !== 'success') return;
    expect(batch.name).toBe('Office change request saved');
    expect(batch.results[0]?.content).toContain(
      'Execution is not yet confirmed'
    );
    expect(batch.results[1]?.content).toContain('3 changes');
    expect(JSON.stringify(batch)).not.toContain('task-2');
    expect(JSON.stringify(batch)).not.toContain('office.command.batch');
  });

  test('preserves and renders native Office tool execution errors', () => {
    const parsed = StreamObjectSchema.parse({
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'workspace_office_read',
      args: { selector: '{"kind":"pdf","page_index":0}' },
      result: { message: 'selector validation failed' },
      isError: true,
    });
    expect(parsed.type).toBe('tool-result');
    if (parsed.type !== 'tool-result') return;
    expect(parsed.isError).toBe(true);
    expect(
      officeToolResultView(parsed.toolName, parsed.result, parsed.isError)
    ).toEqual({
      status: 'error',
      name: 'The file could not be read. Reopen it and try again.',
    });
  });
  test('localizes Office failures without exposing server messages', async () => {
    const i18n = getOrCreateI18n();
    await i18n.changeLanguage('zh-Hans');
    try {
      expect(
        officeToolResultView(
          'workspace_office_command_request',
          { message: 'PRIVATE_SERVER_ERROR' },
          true
        )
      ).toEqual({
        status: 'error',
        name: '无法准备修改请求，请检查文件后重试。',
      });
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('Blocker suggestion confirmation', () => {
  test('accepts only the strict server payload and a UUID v4 suggestion id', () => {
    expect(
      blockerSuggestionFromToolResult('blocker_suggest', blockerSuggestion)
    ).toEqual(blockerSuggestion);
    expect(
      blockerSuggestionFromToolResult('blocker_suggest', {
        ...blockerSuggestion,
        aiSuggestionId: 'not-a-uuid',
      })
    ).toBeNull();
    expect(
      blockerSuggestionFromToolResult('blocker_suggest', {
        ...blockerSuggestion,
        confirmationRequired: false,
      })
    ).toBeNull();
    expect(
      blockerSuggestionFromToolResult('blocker_suggest', {
        ...blockerSuggestion,
        origin: 'user_created',
      })
    ).toBeNull();
    expect(
      blockerSuggestionFromToolResult('blocker_suggest', {
        ...blockerSuggestion,
        confirmationProof: 'p'.repeat(4097),
      })
    ).toBeNull();
    expect(
      blockerSuggestionFromToolResult('blocker_suggest', {
        ...blockerSuggestion,
        confirmationProof: undefined,
      })
    ).toBeNull();
    expect(
      blockerSuggestionFromToolResult('blocker_suggest', {
        ...blockerSuggestion,
        dueAt: '2'.repeat(129),
      })
    ).toBeNull();
    expect(
      blockerSuggestionFromToolResult(
        'blocker_suggest',
        blockerSuggestion,
        true
      )
    ).toBeNull();
  });

  test('keeps the generic tool-result behavior when no confirmation callback is supplied', async () => {
    const { container } = await renderBlockerSuggestion();

    expect(container.querySelector('.blocker-suggestion')).toBeNull();
    const generic = container.querySelector('tool-result-card') as
      | (HTMLElement & { name?: string })
      | null;
    expect(generic).not.toBeNull();
    expect(generic?.name).toBe('blocker_suggest tool result');
    expect(container.querySelector('button')).toBeNull();
  });

  test('requires a click, exposes loading, and suppresses duplicate confirmation', async () => {
    let finish: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const { container, rerender } = await renderBlockerSuggestion({
      onConfirm,
      labels,
    });
    const button = container.querySelector('button');

    expect(button).not.toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(container.textContent).toContain(blockerSuggestion.title);
    expect(container.textContent).toContain(blockerSuggestion.waitingOn);
    expect(container.textContent).not.toContain(
      blockerSuggestion.aiSuggestionId
    );
    expect(container.textContent).not.toContain(
      blockerSuggestion.confirmationProof
    );
    expect(container.innerHTML).not.toContain(
      blockerSuggestion.confirmationProof
    );
    button?.click();
    button?.click();

    rerender();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(blockerSuggestion);
    expect(button?.disabled).toBe(true);
    expect(button?.textContent?.trim()).toBe(labels.creating);

    finish?.();
    await vi.waitFor(async () => {
      await Promise.resolve();
      rerender();
      expect(button?.textContent?.trim()).toBe(labels.created);
    });
    expect(button?.disabled).toBe(true);
  });

  test('retains suggestion content after failure and allows an explicit retry', async () => {
    const onConfirm = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    const { container, rerender } = await renderBlockerSuggestion({
      onConfirm,
      labels,
    });
    const button = container.querySelector('button');
    button?.click();

    await vi.waitFor(async () => {
      await Promise.resolve();
      rerender();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        labels.failed
      );
    });
    expect(container.textContent).toContain(blockerSuggestion.title);
    expect(button?.disabled).toBe(false);

    button?.click();
    await vi.waitFor(async () => {
      await Promise.resolve();
      rerender();
      expect(button?.textContent?.trim()).toBe(labels.created);
    });
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

test('retired resource names are displayed as legacy without classifying current scoped tools as legacy', () => {
  for (const name of [
    'doc_create',
    'doc_read',
    'doc_update',
    'office_command_request',
  ])
    expect(isLegacyResourceToolName(name)).toBe(true);
  for (const name of [
    'workspace_doc_create',
    'project_doc_create',
    'project_resource_update_meta',
    'project_office_read',
  ])
    expect(isLegacyResourceToolName(name)).toBe(false);
});

test('historical and Project write receipts remain readable without Workspace document actions', async () => {
  const { container, instance, rerender } = await renderBlockerSuggestion();
  for (const toolName of [
    'doc_create',
    'doc_update',
    'project_doc_create',
    'project_doc_update',
    'project_resource_update_meta',
  ]) {
    Object.defineProperty(instance, 'answer', {
      value: [
        {
          type: 'tool-result',
          toolCallId: 'persisted-call',
          toolName,
          args: {},
          result: { docId: 'original-resource', markdown: 'x'.repeat(10000) },
        },
      ],
    });
    rerender();
    const card = container.querySelector('tool-result-card') as
      | (HTMLElement & {
          name: string;
          results: { content: string; onClick?: unknown }[];
        })
      | null;
    expect(card?.name).toBe(
      toolName.startsWith('project_') ? toolName : `${toolName} (legacy)`
    );
    expect(card?.results[0]?.content).toContain('original-resource');
    expect(card?.results[0]?.content.length).toBeLessThanOrEqual(8192);
    expect(card?.results[0]?.onClick).toBeUndefined();
    expect(container.querySelector('doc-write-tool')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  }
});
