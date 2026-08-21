type Qwen36AuthorizedDocumentSnapshot = {
  title: string | null;
};

export type Qwen36DocumentReadEvidence = {
  docId: string;
  title?: string;
  markdown: string;
};

export type Qwen36ReadToolEvidence = {
  toolName: string;
  result: string;
};

const QWEN36_DOCUMENT_READ_EVIDENCE_MAX_LENGTH = 48_000;
export const QWEN36_FINAL_ANSWER_REPAIR_MAX_TOKENS = 6_000;

function boundedEvidenceText(value: string) {
  if (value.length <= QWEN36_DOCUMENT_READ_EVIDENCE_MAX_LENGTH) return value;
  const half = QWEN36_DOCUMENT_READ_EVIDENCE_MAX_LENGTH / 2;
  return `${value.slice(0, half)}\n\n[... truncated ...]\n\n${value.slice(-half)}`;
}

const QWEN36_READ_TOOL_NAMES = new Set([
  'doc_read',
  'doc_keyword_search',
  'doc_semantic_search',
  'workspace_folder_list',
]);

export function qwen36ReadToolEvidence(
  toolName: string,
  value: unknown
): Qwen36ReadToolEvidence | undefined {
  if (!QWEN36_READ_TOOL_NAMES.has(toolName)) return undefined;
  try {
    return {
      toolName,
      result: boundedEvidenceText(JSON.stringify(value)),
    };
  } catch {
    return undefined;
  }
}

export function qwen36DocumentReadEvidence(
  value: unknown
): Qwen36DocumentReadEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const result = value as Record<string, unknown>;
  const docId =
    typeof result.docId === 'string' ? result.docId.trim() : undefined;
  const markdown =
    typeof result.markdown === 'string' ? result.markdown : undefined;
  if (!docId || markdown === undefined) return undefined;
  const title =
    typeof result.title === 'string' && result.title.trim()
      ? result.title.trim()
      : undefined;
  return {
    docId,
    ...(title ? { title } : {}),
    markdown: boundedEvidenceText(markdown),
  };
}

function searchResultRecords(value: unknown) {
  const records: Record<string, unknown>[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.docId === 'string' ||
      typeof record.doc_id === 'string' ||
      typeof record.documentId === 'string'
    ) {
      records.push(record);
    }
    if (Array.isArray(record.results)) visit(record.results);
    if (Array.isArray(record.documents)) visit(record.documents);
  };
  visit(value);
  return records;
}

function quotedRequestLiterals(request: string) {
  const literals = new Set<string>();
  for (const match of request.matchAll(/[“"`]([^”"`\r\n]{3,256})[”"`]/g)) {
    const literal = match[1]?.trim();
    if (literal) literals.add(literal);
  }
  return [...literals];
}

export function qwen36SearchResultDocumentId(request: string, value: unknown) {
  const literals = quotedRequestLiterals(request);
  if (!literals.length) return undefined;
  const matchedIds = new Set<string>();
  for (const candidate of searchResultRecords(value)) {
    const rawDocId =
      candidate.docId ?? candidate.doc_id ?? candidate.documentId;
    const docId = typeof rawDocId === 'string' ? rawDocId.trim() : '';
    if (!docId) continue;
    const evidence = JSON.stringify(candidate);
    if (literals.some(literal => evidence.includes(literal))) {
      matchedIds.add(docId);
    }
  }
  return matchedIds.size === 1 ? [...matchedIds][0] : undefined;
}

function singleMarkdownField(markdown: string, field: string) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const values = new Set(
    [
      ...markdown.matchAll(
        new RegExp(`^\\s*(?:[-*]\\s*)?${escaped}\\s*[:：]\\s*(.+?)\\s*$`, 'gim')
      ),
    ]
      .map(match => match[1]?.trim().replace(/^`|`$/g, ''))
      .filter((value): value is string => !!value)
  );
  return values.size === 1 ? [...values][0] : undefined;
}

export function qwen36DeterministicDocumentReadAnswer(
  request: string,
  evidence: Qwen36DocumentReadEvidence | undefined
) {
  if (!evidence || !STRICT_FINAL_OUTPUT.test(request)) return undefined;
  if (/\bMarker\b/i.test(request) && /(?:完整值|\bvalue\b)/i.test(request)) {
    return singleMarkdownField(evidence.markdown, 'Marker');
  }
  const requestsOnlyTitle =
    /(?:只|only)[^。.!?\n]{0,32}(?:输出|返回|return|output)[^。.!?\n]{0,20}(?:文档|document)[^。.!?\n]{0,8}(?:标题|title)|(?:只|only)[^。.!?\n]{0,32}(?:文档标题|document title)[^。.!?\n]{0,20}(?:输出|返回|return|output)/i.test(
      request
    );
  return requestsOnlyTitle ? evidence.title : undefined;
}

const READ_ONLY_OUTPUT =
  /(?:\b(?:return|answer|output|summarize|explain|extract|translate|classify|format|calculate|count|sort)\b|返回|回答|输出|总结|解释|提取|翻译|分类|格式化|计算|计数|排序)/i;
const SIDE_EFFECT =
  /(?:\b(?:create|update|modify|replace|delete|remove|move|rename|send|write)\b|创建|新建|更新|修改|替换|删除|移除|移动|重命名|改名|发送|写入)/i;
const TOOL_LOOKUP =
  /(?:\b(?:search|find|look up|browse|research|attachment|read|open|list|show|tools?)\b|搜索|查找|查询|检索|浏览|联网|网页|附件|读取|打开|列出|查看|工具|不提供文档快照)/i;

const STRICT_FINAL_OUTPUT =
  /(?:\b(?:only|exactly)\s+(?:return|output|respond)|(?:return|output|respond)\s+only\b|只(?:输出|返回|回复)|不要(?:任何)?其他|不得(?:添加|包含).{0,12}(?:文字|内容)|恰好\s*\d+\s*行)/i;

const CHINESE_LINE_COUNTS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export function shouldUseQwen36DirectAnswer(request: string) {
  return (
    READ_ONLY_OUTPUT.test(request) &&
    !SIDE_EFFECT.test(request) &&
    !TOOL_LOOKUP.test(request)
  );
}

export function qwen36NeedsToolAnswerRepair(request: string, _answer: string) {
  return STRICT_FINAL_OUTPUT.test(request);
}

export function qwen36DeterministicSnapshotAnswer(
  request: string,
  documents: readonly Qwen36AuthorizedDocumentSnapshot[]
) {
  if (documents.length !== 1 || !documents[0]?.title) return undefined;
  const requestsOnlyTitle =
    /(?:只|only)[^。.!?\n]{0,32}(?:输出|返回|return|output)[^。.!?\n]{0,20}(?:文档|document)[^。.!?\n]{0,8}(?:标题|title)|(?:只|only)[^。.!?\n]{0,32}(?:文档标题|document title)[^。.!?\n]{0,20}(?:输出|返回|return|output)/i.test(
      request
    );
  return requestsOnlyTitle ? documents[0].title : undefined;
}

function requestedLineCount(request: string) {
  const match = request.match(
    /(?:输出|返回|return|output)\s*(\d+|[一二两三四五六七八九十])\s*(?:行|lines?)/i
  );
  if (!match) return undefined;
  const count = /^\d+$/.test(match[1])
    ? Number(match[1])
    : CHINESE_LINE_COUNTS[match[1]];
  return count && count > 1 && count <= 20 ? count : undefined;
}

function requestedLineValues(request: string, count: number) {
  const match = request.match(
    /(?:依次(?:是|为)|分别(?:是|为)|in\s+order(?:\s+are)?\s*:?)([^。.!?\n]+)/i
  );
  if (!match) return undefined;
  const valueText = match[1].replace(
    /(?:，|,)\s*(?:不要|不得|不能|无需|without|do\s+not|no\s+)/i,
    '\n'
  );
  const values = valueText
    .split('\n')[0]
    .split(/[、，,；;]/)
    .map(value => value.trim())
    .filter(Boolean);
  return values.length === count ? values : undefined;
}

export function qwen36NeedsExplicitLineRepair(request: string, answer: string) {
  const count = requestedLineCount(request);
  if (!count) return false;
  return (
    answer
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean).length !== count
  );
}

export function normalizeQwen36ExplicitAnswerFormat(
  request: string,
  answer: string
) {
  const count = requestedLineCount(request);
  if (!count) return answer;
  const lines = answer
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === count) return lines.join('\n');

  const requestedValues = requestedLineValues(request, count);
  if (requestedValues) return requestedValues.join('\n');

  const answerValues = answer.trim().split(/\s+/).filter(Boolean);
  return answerValues.length === count ? answerValues.join('\n') : answer;
}
