/** @vitest-environment happy-dom */
import { expect, test, vi } from 'vitest';

import {
  ByokNotConfiguredError,
  GeneralNetworkError,
} from '../../provider/error';
import { AIChatMessages } from './ai-chat-messages';

vi.unstubAllGlobals();
customElements.define('test-configuration-messages', AIChatMessages);

test.each([
  {
    notice: true,
    error: new ByokNotConfiguredError('Configure AI'),
    content: '',
    replies: 0,
  },
  {
    notice: false,
    error: new ByokNotConfiguredError('Configure AI'),
    content: '',
    replies: 1,
  },
  {
    notice: true,
    error: new GeneralNetworkError('Offline'),
    content: '',
    replies: 1,
  },
  {
    notice: true,
    error: new ByokNotConfiguredError('Configure AI'),
    content: 'Existing partial answer',
    replies: 1,
  },
])(
  'only merges an empty configuration error when the composer explains it: $notice / $content / $error.type',
  async ({ notice, error, content, replies }) => {
    const messages = document.createElement(
      'test-configuration-messages'
    ) as AIChatMessages;
    messages.configurationNoticeVisible = notice;
    messages.independentMode = true;
    messages.messages = [
      {
        id: 'user',
        role: 'user',
        content: 'Question',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'assistant',
        role: 'assistant',
        content,
        createdAt: new Date().toISOString(),
      },
    ];
    messages.chatContextValue = {
      messages: messages.messages,
      status: 'error',
      error,
      images: [],
      quote: '',
      markdown: '',
      attachments: [],
      docs: [],
      snapshot: null,
      combinedElementsMarkdown: null,
      html: null,
      abortController: null,
    };
    document.body.append(messages);
    try {
      await messages.updateComplete;
      expect(messages.querySelectorAll('chat-message-user')).toHaveLength(1);
      expect(messages.querySelectorAll('chat-message-assistant')).toHaveLength(
        replies
      );
      if (replies) {
        const reply = messages.querySelector(
          'chat-message-assistant'
        ) as HTMLElement & { error: Error | null };
        expect(reply.error).toBe(
          notice && error instanceof ByokNotConfiguredError ? null : error
        );
      }
    } finally {
      messages.remove();
    }
  }
);
