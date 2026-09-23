export type ProjectFilePreview =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'audio' | 'video'; blob: Blob }
  | { kind: 'unsupported' | 'too-large' };

export function projectFilePreviewKind(mime: string, title: string) {
  const type = mime.split(';')[0].trim().toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (
    type.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/javascript'].includes(
      type
    ) ||
    (type === 'application/octet-stream' &&
      /\.(txt|md|csv|json|log|ya?ml)$/i.test(title))
  )
    return 'text';
  return 'unsupported';
}

/** Read previews with a fixed memory budget; never execute uploaded HTML/SVG. */
export async function readProjectFilePreview(
  response: Response,
  title: string
): Promise<ProjectFilePreview> {
  if (!response.ok) throw new Error(`File request failed (${response.status})`);
  const mime =
    response.headers.get('content-type') ?? 'application/octet-stream';
  const kind = projectFilePreviewKind(mime, title);
  const limit = kind === 'text' ? 1024 * 1024 : 32 * 1024 * 1024;
  if (
    kind === 'unsupported' ||
    Number(response.headers.get('content-length')) > limit
  ) {
    await response.body?.cancel();
    return { kind: kind === 'unsupported' ? kind : 'too-large' };
  }
  const reader = response.body?.getReader();
  if (!reader) return { kind: 'unsupported' };
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return { kind: 'too-large' };
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks, { type: mime });
  return kind === 'text' ? { kind, text: await blob.text() } : { kind, blob };
}
