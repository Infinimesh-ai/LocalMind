export function deriveContextMemoryFactKey(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  if (
    /\b(?:answer|respond|response|reply|preference)\b.*\b(?:english|chinese)\b|(?:english|chinese).*(?:answer|respond|response|reply)|(?:回答|回复).*(?:中文|英文)|(?:中文|英文).*(?:回答|回复)/iu.test(
      normalized
    )
  ) {
    return 'preference:response_language';
  }
  if (/\bdeployment region\b|部署区域/iu.test(normalized)) {
    return 'project:deployment_region';
  }
  // Only the project's own codename shares this canonical key. Other named
  // codenames (for example a color or a layout) are independent facts.
  if (
    /项目(?:的)?(?:内部)?代号|\bproject(?:'s)?[\s_-]+(?:internal[\s_-]+)?codename\b/iu.test(
      normalized
    )
  ) {
    return 'project:codename';
  }
  if (/\btimezone\b|时区/iu.test(normalized)) return 'preference:timezone';

  const fact =
    normalized.match(
      /^(?:my |our |the )?([\p{L}\p{N}_ -]{2,80}?)\s*(?:is|are|=|:|：|是|为)\s*\S/iu
    ) ??
    normalized.match(
      /^(?:my |our |the )?([\p{L}\p{N}_ -]{2,80}(?:代号|codename))$/iu
    );
  if (fact?.[1]) {
    return `fact:${fact[1].replace(/\s+/g, '_').slice(0, 80)}`;
  }
  const terms = normalized
    .replace(/[^\p{L}\p{N}_ -]+/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 8)
    .join('_');
  return terms ? `statement:${terms.slice(0, 120)}` : null;
}
