/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test, vi } from 'vitest';

import type { AIChatRuntime, AIChatSnapshot } from '../../runtime/chat';
import { addFilesToChat } from '../ai-chat-chips/attachment-utils';
import { ChatPanelChips } from '../ai-chat-chips/chat-panel-chips';
import type { AIChatInput } from '../ai-chat-input';
import {
  AIChatComposer,
  hasActiveComposerContextOperation,
  initializeComposerContext,
  shouldShowContextProjectSelector,
} from './ai-chat-composer';

vi.unstubAllGlobals();
customElements.define('test-draft-composer', AIChatComposer);
customElements.define('chat-panel-chips', ChatPanelChips);

describe('AIChatComposer', () => {
  test('stages and removes local attachments through the shared composer without uploading', async () => {
    const composer = document.createElement(
      'test-draft-composer'
    ) as AIChatComposer;
    composer.onDraftSend = vi.fn();
    composer.notificationService = {
      toast: vi.fn(),
    } as unknown as AIChatComposer['notificationService'];
    composer.chatContextValue = {
      messages: [],
      status: 'idle',
      error: null,
      images: [],
      attachments: [],
      docs: [],
      snapshot: null,
      combinedElementsMarkdown: null,
      html: null,
      abortController: null,
    };
    composer.updateContext = context => {
      composer.chatContextValue = { ...composer.chatContextValue, ...context };
    };
    document.body.append(composer);
    try {
      await composer.updateComplete;
      const input = composer.querySelector('ai-chat-input') as AIChatInput;
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const image = new File(['image'], 'image.png', { type: 'image/png' });
      await addFilesToChat([file, image], input);
      await composer.updateComplete;
      expect(composer.chips).toEqual([{ file, state: 'finished' }]);
      expect(composer.chatContextValue.images).toEqual([image]);
      await input.addChip({ file, state: 'processing' });
      expect(composer.chips).toHaveLength(1);
      const chips = composer.querySelector(
        'chat-panel-chips'
      ) as HTMLElement & {
        removeChip: (chip: (typeof composer.chips)[number]) => Promise<void>;
      };
      await chips.removeChip(composer.chips[0]);
      expect(composer.chips).toHaveLength(0);
    } finally {
      composer.remove();
    }
  });

  test('loads persisted document context without global user event state', async () => {
    const snapshot = {
      activeSessionId: 'session-1',
      composer: {
        context: {
          embeddingCompleted: true,
          items: [
            {
              kind: 'doc',
              docId: 'doc-1',
              state: 'finished',
            },
          ],
        },
      },
    } as unknown as AIChatSnapshot;
    const dispatch = vi.fn(async (_event: { type: string }) => {});
    const runtime = {
      dispatch,
      getSnapshot: () => snapshot,
    } as unknown as AIChatRuntime;
    const sync = vi.fn();
    const reset = vi.fn();

    await initializeComposerContext(
      runtime,
      'session-1',
      () => true,
      reset,
      sync
    );

    expect(dispatch.mock.calls.map(([event]) => event.type)).toEqual([
      'stopContextPolling',
      'loadContext',
      'startContextPolling',
      'pollEmbeddingStatus',
    ]);
    expect(reset).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  test('does not reload context while a new session context write is active', () => {
    const runtime = {
      getSnapshot: () =>
        ({
          activeSessionId: 'session-1',
          composer: {
            context: {
              loading: true,
            },
          },
        }) as AIChatSnapshot,
    } as unknown as AIChatRuntime;

    expect(hasActiveComposerContextOperation(runtime, 'session-1')).toBe(true);
    expect(hasActiveComposerContextOperation(runtime, 'session-2')).toBe(false);
  });

  test('keeps available projects selectable after clearing the selection', () => {
    const scope = (projectResolution: string, candidates: unknown[] = []) =>
      ({
        loading: false,
        error: null,
        selectedProjectId: null,
        projectResolution,
        candidates,
      }) as AIChatSnapshot['composer']['projectScope'];

    expect(shouldShowContextProjectSelector(scope('none'))).toBe(false);
    expect(
      shouldShowContextProjectSelector(
        scope('none', [{ id: 'project-1', name: 'One' }])
      )
    ).toBe(true);
    expect(shouldShowContextProjectSelector(scope('single'))).toBe(false);
    expect(
      shouldShowContextProjectSelector(
        scope('ambiguous', [{ id: 'project-1', name: 'One' }])
      )
    ).toBe(true);
    expect(shouldShowContextProjectSelector(scope('invalid_selection'))).toBe(
      true
    );
  });
});
