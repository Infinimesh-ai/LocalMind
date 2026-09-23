import { describe, expect, test, vi } from 'vitest';

import { projectFilePreviewKind, readProjectFilePreview } from './file-preview';

describe('Project file preview', () => {
  test('renders markup as text and classifies media without executing uploads', async () => {
    const preview = await readProjectFilePreview(
      new Response('<script>alert(1)</script>', {
        headers: { 'content-type': 'text/html' },
      }),
      'test.html'
    );
    expect(preview).toEqual({
      kind: 'text',
      text: '<script>alert(1)</script>',
    });
    expect(projectFilePreviewKind('image/svg+xml', 'test.svg')).toBe('image');
    expect(projectFilePreviewKind('audio/mpeg', 'test.mp3')).toBe('audio');
    expect(projectFilePreviewKind('video/mp4', 'test.mp4')).toBe('video');
    expect(projectFilePreviewKind('application/octet-stream', 'test.md')).toBe(
      'text'
    );
    expect(projectFilePreviewKind('application/zip', 'test.md')).toBe(
      'unsupported'
    );
  });
  test('preserves the media content type', async () => {
    const result = await readProjectFilePreview(
      new Response('image', { headers: { 'content-type': 'image/png' } }),
      'test.png'
    );
    expect(result.kind).toBe('image');
    expect('blob' in result && result.blob.type).toBe('image/png');
  });
  test('cancels unsupported and oversized bodies before buffering them', async () => {
    for (const mime of ['application/zip', 'text/plain']) {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }), {
        headers: { 'content-type': mime, 'content-length': '2000000' },
      });
      expect(await readProjectFilePreview(response, 'file')).toEqual({
        kind: mime === 'text/plain' ? 'too-large' : 'unsupported',
      });
      expect(cancel).toHaveBeenCalledOnce();
    }
  });
  test('enforces the limit even without content-length', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel,
      }),
      { headers: { 'content-type': 'text/plain' } }
    );
    expect(await readProjectFilePreview(response, 'file.txt')).toEqual({
      kind: 'too-large',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
  test('does not render an authorization failure as file content', async () => {
    await expect(
      readProjectFilePreview(
        new Response('denied', { status: 403 }),
        'test.txt'
      )
    ).rejects.toThrow();
  });
});
