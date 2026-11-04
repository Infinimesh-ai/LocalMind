import { isDeepStrictEqual } from 'node:util';

import diff from 'fast-diff';
import * as Y from 'yjs';

export type NativeTextRun = {
  insert: string;
  attributes?: Record<string, unknown>;
};

const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

export function normalizeNativeRuns(runs: NativeTextRun[]) {
  const result: NativeTextRun[] = [];
  for (const run of runs) {
    if (!run.insert) continue;
    const attributes = Object.fromEntries(
      Object.entries(run.attributes ?? {}).filter(
        ([, value]) => value !== null && value !== undefined
      )
    );
    const previous = result.at(-1);
    if (previous && isDeepStrictEqual(previous.attributes, attributes))
      previous.insert += run.insert;
    else result.push({ insert: run.insert, attributes });
  }
  return result;
}

export function isTextBoundary(text: string, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    return false;
  if (offset === 0 || offset === text.length) return true;
  for (const segment of graphemes.segment(text)) {
    if (segment.index === offset) return true;
    if (segment.index > offset) return false;
  }
  return false;
}

/** Retain the Y.Text and unchanged CRDT items, including their relative anchors. */
export function reconcileNativeText(
  text: Y.Text,
  target: Y.Text,
  preserveMark?: (key: string) => boolean
) {
  return reconcileNativeTextRange(
    text,
    0,
    text.length,
    target.toDelta(),
    preserveMark
  );
}

/** Diff only the explicitly selected range; repeated text outside it is never matched. */
export function reconcileNativeTextRange(
  text: Y.Text,
  offset: number,
  length: number,
  desired: NativeTextRun[],
  preserveMark?: (key: string) => boolean
) {
  const previous = text.toString().slice(offset, offset + length);
  const next = desired.map(run => run.insert).join('');
  if (
    [...text.toDelta(), ...desired].some(run => typeof run.insert !== 'string')
  )
    throw new Error('Embedded text values require a native adapter');
  let at = offset;
  for (const [kind, value] of diff(previous, next)) {
    if (kind === diff.DELETE) text.delete(at, value.length);
    else {
      if (kind === diff.INSERT) text.insert(at, value, {});
      at += value.length;
    }
  }

  // Formatting is a separate operation: identical text must not be reinserted.
  let runOffset = 0;
  const existing = (text.toDelta() as NativeTextRun[]).flatMap(run => {
    const start = Math.max(0, offset - runOffset);
    const end = Math.min(run.insert.length, offset + next.length - runOffset);
    runOffset += run.insert.length;
    return end > start
      ? [{ insert: run.insert.slice(start, end), attributes: run.attributes }]
      : [];
  });
  let position = offset;
  let oldIndex = 0;
  let oldOffset = 0;
  for (const run of desired) {
    let remaining = run.insert.length;
    while (remaining > 0) {
      const old = existing[oldIndex];
      const length = Math.min(remaining, old.insert.length - oldOffset);
      if (!isDeepStrictEqual(old.attributes ?? {}, run.attributes ?? {})) {
        const marks: Record<string, unknown> = {};
        for (const key of Object.keys(old.attributes ?? {}))
          if (!key.startsWith('comment-') && !preserveMark?.(key))
            marks[key] = null;
        Object.assign(marks, run.attributes);
        text.format(position, length, marks);
      }
      position += length;
      remaining -= length;
      oldOffset += length;
      if (oldOffset === old.insert.length) {
        oldIndex++;
        oldOffset = 0;
      }
    }
  }
}
