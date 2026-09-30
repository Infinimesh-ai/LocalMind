import { officeFormatForFileName } from '@affine/core/modules/office';
import type { Workspace } from '@affine/core/modules/workspace';
import { sha } from '@blocksuite/global/utils';
import { nanoid } from 'nanoid';

const uploadIds = new WeakMap<File, string>();

export async function uploadWorkspaceNativeBlob(
  workspace: Workspace,
  file: File
) {
  const office = /\.(docx|xlsx|pptx|pdf)$/i.test(file.name)
    ? officeFormatForFileName(file.name)
    : null;
  if (file.size > (office ? 512 : 32) * 1024 * 1024)
    throw new Error('File exceeds its upload size limit');
  const mime = office?.mimeType ?? (file.type || 'application/octet-stream');
  const data = new Uint8Array(await file.arrayBuffer());
  // MIME participates in identity: identical TXT/Markdown bytes retain their type.
  let uploadId = uploadIds.get(file);
  if (!uploadId) {
    uploadId = nanoid();
    uploadIds.set(file, uploadId);
  }
  const key = `native-upload-${uploadId}-${await sha(await new Blob([mime, '\0', data]).arrayBuffer())}`;
  await workspace.engine.blob.set({ key, data, mime });
  await workspace.engine.blob.upload(key);
  return key;
}
