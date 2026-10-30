/**
 * @vitest-environment happy-dom
 */
import type { CopilotChatHistoryFragment } from '@affine/graphql';
import { html } from 'lit';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { AIChatRuntime, AIChatSnapshot } from '../../runtime/chat';
import { AIChatToolbar } from './ai-chat-toolbar';
import { AISessionHistory } from './ai-session-history';

vi.mock('@blocksuite/affine/components/portal', async () => {
  const { render } = await import('lit');
  return {
    createLitPortal: vi.fn(({ template, abortController }) => {
      const portal = document.createElement('div');
      const update = () => render(template({ updatePortal: update }), portal);
      document.body.append(portal);
      abortController.signal.addEventListener('abort', () => portal.remove());
      update();
      return { portal, update };
    }),
  };
});

vi.unstubAllGlobals();
customElements.define('test-chat-toolbar', AIChatToolbar);
if (!customElements.get('ai-session-history')) {
  customElements.define('ai-session-history', AISessionHistory);
}

afterEach(() => {
  document.body.replaceChildren();
});

function session(
  id = 'chat-1',
  docId: string | null = null
): CopilotChatHistoryFragment {
  return {
    sessionId: id,
    workspaceId: 'workspace-1',
    title: `Conversation ${id}`,
    docId,
    selectedContextProjectId: null,
    parentSessionId: null,
    promptName: 'Chat With LocalMind AI',
    model: 'test-model',
    optionalModels: [],
    action: null,
    pinned: false,
    tokens: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

async function setup() {
  const listeners = new Set<() => void>();
  const snapshot = {
    status: 'success',
    uiPolicy: { canCreateNewSession: true },
    history: { recent: [], currentDoc: [], loading: false, error: null },
  } as unknown as AIChatSnapshot;
  let finishRefresh = () => {};
  const emit = () => listeners.forEach(listener => listener());
  const dispatch = vi.fn((action: { type: string }) => {
    if (action.type !== 'refreshHistory') return Promise.resolve();
    snapshot.history = { ...snapshot.history, loading: true, error: null };
    emit();
    return new Promise<void>(resolve => {
      finishRefresh = resolve;
    });
  });
  const toolbar = document.createElement('test-chat-toolbar') as AIChatToolbar;
  toolbar.runtime = {
    dispatch,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as AIChatRuntime;
  toolbar.runtimeSnapshot = snapshot;
  toolbar.session = session();
  toolbar.docDisplayConfig = {
    getIcon: () => html``,
    getTitle: () => 'Document',
  } as unknown as AIChatToolbar['docDisplayConfig'];
  toolbar.notificationService = {
    confirm: vi.fn().mockResolvedValue(false),
    toast: vi.fn(),
  } as unknown as AIChatToolbar['notificationService'];
  toolbar.onSessionDelete = vi.fn();
  toolbar.onOpenDoc = vi.fn();
  document.body.append(toolbar);
  await toolbar.updateComplete;
  const historyButton = toolbar.querySelector<HTMLButtonElement>(
    '[data-testid="ai-panel-chat-history"]'
  )!;
  const history = () =>
    document.querySelector<AISessionHistory>('ai-session-history')!;
  const complete = async (error: Error | null = null) => {
    snapshot.history = {
      recent: [session()],
      currentDoc: [],
      loading: false,
      error,
    };
    emit();
    finishRefresh();
    await history()?.updateComplete;
  };
  return {
    toolbar,
    historyButton,
    history,
    complete,
    snapshot,
    dispatch,
    listeners,
  };
}

describe('chat toolbar and history accessibility', () => {
  test('Project hides new chat while retaining pin and history, and Workspace keeps runtime drafts', async () => {
    const { toolbar, dispatch } = await setup();
    toolbar.showNewConversation = false;
    await toolbar.updateComplete;
    expect(
      toolbar.querySelector('[data-testid="ai-panel-new-chat"]')
    ).toBeNull();
    expect(
      toolbar.querySelector('[data-testid="ai-panel-pin-chat"]')
    ).not.toBeNull();
    expect(
      toolbar.querySelector('[data-testid="ai-panel-chat-history"]')
    ).not.toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    toolbar.showNewConversation = true;
    await toolbar.updateComplete;
    toolbar
      .querySelector<HTMLButtonElement>('[data-testid="ai-panel-new-chat"]')!
      .click();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledWith({ type: 'createNewSession' });
  });
  test('toolbar controls are labelled native buttons with pressed and expanded states', async () => {
    const { toolbar, historyButton } = await setup();
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.type).toBe('button');
      expect(button.tabIndex).toBe(0);
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
    expect(historyButton.getAttribute('aria-expanded')).toBe('false');
  });

  test('history appears while refreshing and updates without reopening', async () => {
    const { historyButton, history, complete } = await setup();
    historyButton.click();
    await history().updateComplete;
    const initial = history();
    expect(initial.querySelector('[role="status"]')).not.toBeNull();
    expect(initial.querySelector('button')).toBeNull();
    await complete();
    expect(history()).toBe(initial);
    expect(initial.querySelector('.ai-session-title')?.textContent).toContain(
      'Conversation chat-1'
    );
    expect(initial.querySelector('[role="status"]')).toBeNull();
  });

  test('closing a pending refresh unsubscribes and late completion does not reopen it', async () => {
    const { toolbar, historyButton, history, complete, listeners } =
      await setup();
    historyButton.click();
    await history().updateComplete;
    historyButton.click();
    await toolbar.updateComplete;
    expect(listeners.size).toBe(0);
    await complete();
    expect(history()).toBeNull();
    expect(historyButton.getAttribute('aria-expanded')).toBe('false');
  });

  test('an error has a retry action instead of an empty or stale successful list', async () => {
    const { historyButton, history, complete, dispatch } = await setup();
    historyButton.click();
    await complete(new Error('private upstream error'));
    expect(history().querySelector('[role="alert"]')).not.toBeNull();
    expect(history().textContent).not.toContain('private upstream error');
    expect(history().querySelector('.ai-session-title')).toBeNull();
    history().querySelector<HTMLButtonElement>('button')!.click();
    await history().updateComplete;
    expect(
      dispatch.mock.calls.filter(([a]) => a.type === 'refreshHistory')
    ).toHaveLength(2);
    expect(history().querySelector('[role="status"]')).not.toBeNull();
    await complete();
    expect(history().querySelector('[role="alert"]')).toBeNull();
  });

  test('Escape closes history and restores trigger focus', async () => {
    const { historyButton, history } = await setup();
    historyButton.click();
    await history().updateComplete;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(
      history().querySelector('.ai-session-history')
    );
    history()
      .querySelector('.ai-session-history')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    expect(history()).toBeNull();
    expect(document.activeElement).toBe(historyButton);
  });

  test('disconnecting removes the open portal and its subscription', async () => {
    const { toolbar, historyButton, history, listeners } = await setup();
    historyButton.click();
    toolbar.remove();
    expect(listeners.size).toBe(0);
    expect(history()).toBeNull();
  });

  test('history open, document and delete actions are separate native buttons', async () => {
    const { toolbar, historyButton, history, complete, snapshot } =
      await setup();
    historyButton.click();
    await complete();
    history().recentSessions = [session('other', 'doc-1')];
    await history().updateComplete;
    const open =
      history().querySelector<HTMLButtonElement>('.ai-session-title')!;
    const doc = history().querySelector<HTMLButtonElement>('.ai-session-doc')!;
    const remove = history().querySelector<HTMLButtonElement>(
      '.ai-session-item-delete'
    )!;
    expect([open, doc, remove].every(button => button.tabIndex === 0)).toBe(
      true
    );
    remove.click();
    expect(toolbar.onSessionDelete).toHaveBeenCalledTimes(1);
    expect(toolbar.onOpenDoc).not.toHaveBeenCalled();
    doc.click();
    expect(toolbar.onOpenDoc).toHaveBeenCalledWith('doc-1', 'other');
    expect(snapshot.history.recent).toHaveLength(1);
  });

  test('cancelled unpin confirmation prevents new session creation', async () => {
    const { toolbar, dispatch } = await setup();
    toolbar.session = { ...session(), pinned: true };
    await toolbar.updateComplete;
    toolbar
      .querySelector<HTMLButtonElement>('[data-testid="ai-panel-new-chat"]')!
      .click();
    await Promise.resolve();
    await Promise.resolve();
    expect(toolbar.notificationService.confirm).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
