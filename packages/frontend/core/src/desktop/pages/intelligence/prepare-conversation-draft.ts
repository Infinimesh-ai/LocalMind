import type { AIChatDraft } from '@affine/core/blocksuite/ai/components/ai-chat-input';
import type {
  AIChatRuntime,
  AIChatSendOptions,
} from '@affine/core/blocksuite/ai/runtime/chat';
import { readBlobAsURL } from '@affine/core/blocksuite/ai/utils/image';

/** Reuse the normal Project context upload path before submitting the first message. */
export async function prepareConversationDraft(
  runtime: Pick<AIChatRuntime, 'dispatch' | 'getSnapshot'>,
  draft: AIChatDraft,
  uploadedFiles: Set<File>
): Promise<AIChatSendOptions> {
  for (const file of draft.files) {
    if (uploadedFiles.has(file)) continue;
    await runtime.dispatch({
      type: 'addContextItem',
      item: { kind: 'file', file },
    });
    const { error } = runtime.getSnapshot().composer.context;
    if (error) throw error;
    uploadedFiles.add(file);
  }
  return {
    input: draft.text,
    attachments: draft.images,
    attachmentPreviews: await Promise.all(draft.images.map(readBlobAsURL)),
  };
}
