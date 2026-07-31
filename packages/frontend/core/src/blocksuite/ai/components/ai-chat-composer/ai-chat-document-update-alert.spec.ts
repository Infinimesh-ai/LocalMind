/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import {
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
});
