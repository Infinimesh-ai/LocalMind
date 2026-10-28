import { toast } from '@affine/component';

import type { ChatChip } from './type';

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

export interface AttachmentHandlers {
  addImages: (images: File[]) => void;
  addChip: (chip: ChatChip, silent?: boolean) => Promise<void>;
}

export async function addFilesToChat(
  files: File[],
  { addImages, addChip }: AttachmentHandlers
): Promise<void> {
  if (!files.length) return;

  const images = files.filter(file => file.type.startsWith('image/'));
  if (images.length > 0) {
    addImages(images);
  }

  const others = files.filter(file => !file.type.startsWith('image/'));
  // Context mutations use a shared request sequence. Wait for each addition
  // before starting the next so a later file cannot supersede an earlier one.
  for (const file of others) {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      toast(`${file.name} is too large, please upload a file less than 50MB`);
      continue;
    }
    await addChip({
      file,
      state: 'processing',
    });
  }
}
