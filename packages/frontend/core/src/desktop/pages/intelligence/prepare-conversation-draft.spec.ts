/** @vitest-environment happy-dom */
import type {
  AIChatRuntime,
  AIChatSnapshot,
} from '@affine/core/blocksuite/ai/runtime/chat';
import { describe, expect, test, vi } from 'vitest';

import { prepareConversationDraft } from './prepare-conversation-draft';

describe('first conversation message attachments', () => {
  test('uploads files in order and keeps images on the message', async () => {
    const file = new File(['notes'], 'notes.txt');
    const image = new File(['image'], 'chart.png', { type: 'image/png' });
    const dispatch = vi.fn<AIChatRuntime['dispatch']>().mockResolvedValue();
    const runtime = {
      dispatch,
      getSnapshot: () =>
        ({ composer: { context: { error: null } } }) as AIChatSnapshot,
    };
    const uploaded = new Set<File>();
    const options = await prepareConversationDraft(
      runtime,
      { text: 'Read both', files: [file], images: [image] },
      uploaded
    );
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'addContextItem',
      item: { kind: 'file', file },
    });
    expect(options).toEqual({
      input: 'Read both',
      attachments: [image],
      attachmentPreviews: ['data:image/png;base64,aW1hZ2U='],
    });
    expect(uploaded.has(file)).toBe(true);
  });

  test('stops on upload failure and retries only unfinished files', async () => {
    const first = new File(['one'], 'one.txt');
    const second = new File(['two'], 'two.txt');
    const draft = { text: 'Read files', files: [first, second], images: [] };
    const uploaded = new Set<File>();
    let error: Error | null = null;
    let fail = true;
    const dispatch = vi.fn<AIChatRuntime['dispatch']>(async action => {
      error =
        action.type === 'addContextItem' &&
        action.item.kind === 'file' &&
        action.item.file === second &&
        fail
          ? new Error('Upload failed')
          : null;
    });
    const runtime = {
      dispatch,
      getSnapshot: () =>
        ({ composer: { context: { error } } }) as AIChatSnapshot,
    };
    await expect(
      prepareConversationDraft(runtime, draft, uploaded)
    ).rejects.toThrow('Upload failed');
    expect(uploaded).toEqual(new Set([first]));
    fail = false;
    await expect(
      prepareConversationDraft(runtime, draft, uploaded)
    ).resolves.toMatchObject({ input: 'Read files' });
    expect(
      dispatch.mock.calls.map(([action]) =>
        action.type === 'addContextItem' && action.item.kind === 'file'
          ? action.item.file.name
          : ''
      )
    ).toEqual(['one.txt', 'two.txt', 'two.txt']);
  });
});
