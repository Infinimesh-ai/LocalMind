/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test, vi } from 'vitest';

import { AIChatContent } from './ai-chat-content';

describe('AIChatContent pinned scroll tracking', () => {
  test('records scroll position from the chat messages host', async () => {
    let scrollEndHandler: (() => void) | undefined;

    const chatMessages = {
      scrollTop: 256,
      updateComplete: Promise.resolve(),
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        if (event === 'scrollend') {
          scrollEndHandler = handler as () => void;
        }
      }),
    };

    const content = {
      chatMessagesRef: { value: chatMessages },
      _scrollListenersInitialized: false,
      lastScrollTop: undefined,
    } as unknown as AIChatContent;

    (AIChatContent.prototype as any)._initializeScrollListeners.call(content);
    await chatMessages.updateComplete;
    await Promise.resolve();

    expect(chatMessages.addEventListener).toHaveBeenCalledWith(
      'scrollend',
      expect.any(Function)
    );

    scrollEndHandler?.();

    expect((content as any).lastScrollTop).toBe(256);
  });
});

describe('AIChatContent runtime snapshot sync', () => {
  test('derives messages and loading state from runtime snapshot', () => {
    const runtimeMessage = {
      id: 'message-1',
      role: 'user',
      content: 'hello',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const content = Object.create(AIChatContent.prototype) as AIChatContent;
    Object.defineProperty(content, 'runtimeSnapshot', {
      configurable: true,
      value: {
        messages: [runtimeMessage],
        status: 'loading',
        error: null,
        readiness: 'initializing',
        history: { loading: false },
      },
    });
    Object.defineProperty(content, 'chatContextValue', {
      configurable: true,
      value: {
        messages: [],
        status: 'idle',
        error: null,
        abortController: null,
      },
    });
    Object.defineProperty(content, '_initializeScrollListeners', {
      configurable: true,
      value: vi.fn(),
    });

    (content as any).updated(new Map([['runtimeSnapshot', null]]));

    expect(content.messages).toEqual([runtimeMessage]);
    expect(content.isHistoryLoading).toBe(true);
    expect(content.chatContextValue.messages).toEqual([]);
    expect(content.chatContextValue.status).toBe('idle');
  });
});

describe('AIChatContent open with chat prompt scope', () => {
  test('stores promptName from matching open-with-chat request', () => {
    const host = {} as NonNullable<AIChatContent['host']>;
    const updateContext = vi.fn();
    const content = Object.create(AIChatContent.prototype) as AIChatContent;
    Object.defineProperty(content, 'host', {
      configurable: true,
      value: host,
    });
    Object.defineProperty(content, 'promptName', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(content, 'updateContext', {
      configurable: true,
      value: updateContext,
    });

    (content as any).handleOpenWithChat({
      host,
      fromAnswer: true,
      context: { html: '<main></main>' },
      promptName: 'Make it real',
    });

    expect((content as any).promptName).toBe('Make it real');
    expect(updateContext).toHaveBeenCalledWith({ html: '<main></main>' });
  });

  test('uses handoff promptName before a session exists', () => {
    const content = Object.create(AIChatContent.prototype) as AIChatContent;
    Object.defineProperty(content, 'session', {
      configurable: true,
      value: null,
    });
    Object.defineProperty(content, 'promptName', {
      configurable: true,
      writable: true,
      value: 'Make it real',
    });

    expect((content as any).activePromptName).toBe('Make it real');
  });

  test('uses session promptName over stale handoff promptName', () => {
    const content = Object.create(AIChatContent.prototype) as AIChatContent;
    Object.defineProperty(content, 'session', {
      configurable: true,
      value: { promptName: 'Chat With AFFiNE AI' },
    });
    Object.defineProperty(content, 'promptName', {
      configurable: true,
      writable: true,
      value: 'Make it real',
    });

    expect((content as any).activePromptName).toBe('Chat With AFFiNE AI');
  });

  test('ignores promptName from a different host', () => {
    const content = Object.create(AIChatContent.prototype) as AIChatContent;
    Object.defineProperty(content, 'host', {
      configurable: true,
      value: {},
    });
    Object.defineProperty(content, 'promptName', {
      configurable: true,
      writable: true,
      value: 'Summary',
    });

    (content as any).handleOpenWithChat({
      host: {},
      fromAnswer: true,
      context: { html: '<main></main>' },
      promptName: 'Make it real',
    });

    expect((content as any).promptName).toBe('Summary');
  });
});
