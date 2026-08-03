/**
 * @vitest-environment happy-dom
 */
import { render } from 'lit';
import { describe, expect, test, vi } from 'vitest';

import {
  AIChatDocumentUpdateAlert,
  createDocumentUpdateSignature,
  createDocumentUpdateStorageKey,
  isDocumentUpdateDismissed,
  persistDocumentUpdateDismissal,
} from './ai-chat-document-update-alert';

describe('AIChatDocumentUpdateAlert', () => {
  test('creates a stable version signature', () => {
    expect(
      createDocumentUpdateSignature([
        { docId: 'doc-2', updatedAt: 30 },
        { docId: 'doc-1', updatedAt: 20 },
      ])
    ).toBe('doc-1:20|doc-2:30');
  });

  test('persists dismissal for the current workspace and session', () => {
    localStorage.clear();
    const storageKey = createDocumentUpdateStorageKey(
      'workspace-1',
      'session-1'
    );

    expect(
      persistDocumentUpdateDismissal(localStorage, storageKey, [
        { docId: 'doc-1', updatedAt: 20 },
        { docId: 'doc-2', updatedAt: 30 },
      ])
    ).toBe(true);
    expect(
      isDocumentUpdateDismissed(localStorage, storageKey, [
        { docId: 'doc-1', updatedAt: 20 },
      ])
    ).toBe(true);
    expect(
      isDocumentUpdateDismissed(localStorage, storageKey, [
        { docId: 'doc-1', updatedAt: 21 },
      ])
    ).toBe(false);
    expect(
      isDocumentUpdateDismissed(
        localStorage,
        createDocumentUpdateStorageKey('workspace-1', 'session-2'),
        [{ docId: 'doc-1', updatedAt: 20 }]
      )
    ).toBe(false);
  });

  test('keeps each dismissed document version independent', () => {
    localStorage.clear();
    const storageKey = createDocumentUpdateStorageKey(
      'workspace-1',
      'session-1'
    );
    persistDocumentUpdateDismissal(localStorage, storageKey, [
      { docId: 'doc-1', updatedAt: 20 },
      { docId: 'doc-2', updatedAt: 30 },
    ]);

    expect(
      isDocumentUpdateDismissed(localStorage, storageKey, [
        { docId: 'doc-1', updatedAt: 20 },
      ])
    ).toBe(true);
    expect(
      isDocumentUpdateDismissed(localStorage, storageKey, [
        { docId: 'doc-2', updatedAt: 31 },
      ])
    ).toBe(false);
  });

  test('expires stale dismissal records and removes their storage key', () => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const storageKey = createDocumentUpdateStorageKey(
      'workspace-1',
      'session-1'
    );
    persistDocumentUpdateDismissal(localStorage, storageKey, [
      { docId: 'doc-1', updatedAt: 20 },
    ]);

    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);

    expect(
      isDocumentUpdateDismissed(localStorage, storageKey, [
        { docId: 'doc-1', updatedAt: 20 },
      ])
    ).toBe(false);
    expect(localStorage.getItem(storageKey)).toBeNull();
    vi.useRealTimers();
  });

  test('fails open when browser storage is unavailable', () => {
    const unavailableStorage = {
      getItem() {
        throw new Error('unavailable');
      },
      setItem() {
        throw new Error('unavailable');
      },
    };

    expect(
      isDocumentUpdateDismissed(unavailableStorage, 'key', [
        { docId: 'doc-1', updatedAt: 20 },
      ])
    ).toBe(false);
    expect(
      persistDocumentUpdateDismissal(unavailableStorage, 'key', [
        { docId: 'doc-1', updatedAt: 20 },
      ])
    ).toBe(false);
  });

  test('renders localized document labels and handles its actions', async () => {
    localStorage.clear();
    const onNewChat = vi.fn();
    const alert = Object.create(
      AIChatDocumentUpdateAlert.prototype
    ) as AIChatDocumentUpdateAlert;
    Object.defineProperties(alert, {
      workspaceId: { value: 'workspace-1', writable: true },
      sessionId: { value: 'session-1', writable: true },
      documents: {
        value: [
          { docId: 'doc-1', updatedAt: 20 },
          { docId: 'doc-2', updatedAt: 30 },
          { docId: 'doc-3', updatedAt: 40 },
        ],
        writable: true,
      },
      docDisplayConfig: {
        value: {
          getTitle: (docId: string) =>
            docId === 'doc-1' ? 'Release plan' : '',
        },
        writable: true,
      },
      onNewChat: { value: onNewChat, writable: true },
      requestUpdate: { value: vi.fn() },
    });
    const container = document.createElement('div');
    render(alert.render(), container);

    expect(container.textContent).toContain('Document updated');
    expect(container.textContent).toContain('Release plan');
    expect(container.textContent).toContain('and 1 more');

    const newChatButton = container.querySelector(
      '[data-testid="ai-chat-document-update-new-chat"]'
    );
    expect(newChatButton).toBeInstanceOf(HTMLButtonElement);
    (newChatButton as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onNewChat).toHaveBeenCalledOnce();

    const dismissButton = container.querySelector(
      '[data-testid="ai-chat-document-update-dismiss"]'
    );
    expect(dismissButton).toBeInstanceOf(HTMLButtonElement);
    (dismissButton as HTMLButtonElement).click();
    expect(
      isDocumentUpdateDismissed(
        localStorage,
        createDocumentUpdateStorageKey('workspace-1', 'session-1'),
        alert.documents
      )
    ).toBe(true);
  });
});
