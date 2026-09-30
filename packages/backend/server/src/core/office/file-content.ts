import { BadRequest } from '../../base';

export const NATIVE_TEXT_MAX_BYTES = 1024 * 1024;
export const NATIVE_FILE_MAX_BYTES = 32 * 1024 * 1024;

const TEXT_MIME = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
} as const;

export function nativeTextFormat(title: string) {
  const extension = title.split('.').at(-1)?.toLowerCase();
  return extension && Object.hasOwn(TEXT_MIME, extension)
    ? (extension as keyof typeof TEXT_MIME)
    : null;
}

/** Complete, lossless UTF-8 only. A preview must never become a replacement. */
export function decodeNativeText(bytes: Uint8Array, title: string) {
  if (!nativeTextFormat(title))
    throw new BadRequest(
      'Text editing supports TXT, Markdown, CSV and JSON files'
    );
  if (bytes.byteLength > NATIVE_TEXT_MAX_BYTES)
    throw new BadRequest(
      'This file exceeds the text editing limit; download or replace the file instead'
    );
  try {
    const text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (text.includes('\0')) throw new Error('Binary content');
    return text;
  } catch {
    throw new BadRequest(
      'This file is not lossless UTF-8 text; download or replace the file instead'
    );
  }
}

export function encodeNativeText(text: string, title: string) {
  const bytes = Buffer.from(text, 'utf8');
  if (decodeNativeText(bytes, title) !== text)
    throw new BadRequest('File text contains invalid Unicode');
  if (nativeTextFormat(title) === 'json') {
    try {
      JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new BadRequest('The file must contain valid JSON');
    }
  }
  return bytes;
}

export function nativeTextMime(title: string) {
  const format = nativeTextFormat(title);
  if (!format) throw new BadRequest('Unsupported text file format');
  return TEXT_MIME[format];
}

export function nativeFileSearchText(bytes: Uint8Array, title: string) {
  try {
    return decodeNativeText(bytes, title).slice(0, 250000);
  } catch {
    return '';
  }
}
