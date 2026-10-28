/** Only explicit, unambiguous owner preferences become deterministic constraints. */
export function requestedChapterCount(instructions: string | undefined) {
  const counts = new Set<number>();
  const text = instructions ?? '';
  const number = '(?:\\d{1,2}|[一二三四五六七八九十两]{1,3})';
  const patterns = [
    new RegExp(
      `(?:用|共|恰好|正好|必须|分成|分为|生成|输出|制作|包含|保持)\\s*(${number})\\s*(?:个)?章(?:节)?`,
      'g'
    ),
    /\b(?:exactly|use|create|generate|keep)\s+(\d{1,2})\s+chapters?\b/gi,
    /\bchapter\s+count\s*[:=]\s*(\d{1,2})\b/gi,
  ];
  for (const pattern of patterns)
    for (const match of text.matchAll(pattern)) {
      const prefix = text.slice(Math.max(0, match.index - 8), match.index);
      if (/(?:不要|不必|无需|不应|不得|不是|别|not)\s*$/i.test(prefix))
        continue;
      const raw = match[1];
      const digit = (s: string) =>
        '零一二三四五六七八九'.indexOf(s.replace('两', '二'));
      const value = /^\d+$/.test(raw)
        ? Number(raw)
        : raw.includes('十')
          ? (raw.startsWith('十') ? 1 : digit(raw[0])) * 10 +
            (raw.endsWith('十') ? 0 : digit(raw.slice(-1)))
          : digit(raw);
      if (value >= 2 && value <= 14) counts.add(value);
    }
  return counts.size === 1 ? [...counts][0] : undefined;
}

export function chapterCountErrors(
  instructions: string | undefined,
  actual: number
) {
  const expected = requestedChapterCount(instructions);
  return expected !== undefined && actual !== expected
    ? [
        `The owner requires exactly ${expected} chapters; received ${actual}. Preserve this count during repairs; do not merge chapters below it or invent facts.`,
      ]
    : [];
}
