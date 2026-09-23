/**
 * @vitest-environment happy-dom
 */
import { render } from 'lit';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { AIChatRuntime, AIChatSnapshot } from '../../runtime/chat';
import { AIContextCompactionStatus } from './ai-context-compaction-status';

function snapshot(
  status: string,
  overrides: Record<string, unknown> = {}
): AIChatSnapshot {
  return {
    activeSessionId: 'session-1',
    messages: [],
    status: 'idle',
    uiPolicy: { canRequestContextCompaction: true },
    contextCompaction: {
      loading: false,
      polling: status === 'running',
      error: null,
      events: [],
      dismissedTaskId: null,
      task: {
        id: 'task-1',
        sessionId: 'session-1',
        contextEpoch: 1,
        status,
        summarizedMessageCount: 12,
        attempt: 1,
        maxAttempts: 3,
        inputBudget: 4096,
        inputTokensEstimated: 3200,
        outputTokensEstimated: 420,
        outputCharacters: 1100,
        failureCode: null,
        failureMessage: null,
        checkpointId: status === 'succeeded' ? 'checkpoint-1' : null,
        summary: status === 'succeeded' ? 'Current goal: ship safely' : null,
        summaryData: null,
        requestedAt: '2026-09-22T00:00:00.000Z',
        updatedAt: '2026-09-22T00:00:01.000Z',
        completedAt: status === 'succeeded' ? '2026-09-22T00:00:01.000Z' : null,
        ...overrides,
      },
    },
  } as unknown as AIChatSnapshot;
}

async function renderStatus(value: AIChatSnapshot) {
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const element = Object.create(
    AIContextCompactionStatus.prototype
  ) as AIContextCompactionStatus;
  Object.defineProperty(element, 'runtime', {
    configurable: true,
    value: { dispatch } as unknown as AIChatRuntime,
  });
  Object.defineProperty(element, 'snapshot', {
    configurable: true,
    value,
  });
  const container = document.createElement('div');
  render(element.render(), container);
  await Promise.resolve();
  return { container, dispatch };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('AIContextCompactionStatus', () => {
  test('announces durable progress and lets the user cancel', async () => {
    const { container, dispatch } = await renderStatus(snapshot('running'));
    const panel = container.querySelector(
      '[data-testid="ai-context-compaction-status"]'
    );
    expect(panel?.getAttribute('role')).toBe('status');
    expect(panel?.getAttribute('aria-live')).toBe('polite');

    const cancel = container.querySelector<HTMLButtonElement>(
      '[data-testid="ai-context-compaction-cancel"]'
    );
    cancel?.click();
    expect(dispatch).toHaveBeenCalledWith({
      type: 'cancelContextCompaction',
    });
  });

  test('shows token evidence and a reviewable summary after success', async () => {
    const { container } = await renderStatus(snapshot('succeeded'));
    const details = container.querySelector('details');
    expect(details?.textContent).toContain('Current goal: ship safely');
    expect(container.textContent).toContain('3200');
    expect(container.textContent).toContain('420');
  });

  test('offers retry after failure without hiding the failure code', async () => {
    const { container, dispatch } = await renderStatus(
      snapshot('failed', {
        failureCode: 'MODEL_OUTPUT_INVALID',
        failureMessage: 'The structured summary was invalid',
      })
    );
    expect(container.textContent).toContain('MODEL_OUTPUT_INVALID');
    const retry = container.querySelector<HTMLButtonElement>(
      '[data-testid="ai-context-compaction-retry"]'
    );
    retry?.click();
    expect(dispatch).toHaveBeenCalledWith({ type: 'retryContextCompaction' });
  });
});
