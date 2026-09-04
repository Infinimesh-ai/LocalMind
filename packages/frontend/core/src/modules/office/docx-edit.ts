export type TextReplacement = {
  start: number;
  end: number;
  text: string;
};

function avoidSurrogateSplit(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) return offset;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
    ? offset - 1
    : offset;
}

export function diffTextReplacement(
  before: string,
  after: string
): TextReplacement | null {
  if (before === after) return null;
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }
  start = avoidSurrogateSplit(before, start);
  start = avoidSurrogateSplit(after, start);

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd--;
    afterEnd--;
  }
  beforeEnd = avoidSurrogateSplit(before, beforeEnd);
  afterEnd = avoidSurrogateSplit(after, afterEnd);
  return {
    start,
    end: beforeEnd,
    text: after.slice(start, afterEnd),
  };
}
