import {
  type ReportDocument,
  ReportDocumentSchema,
  type ReportNode,
  type ReportResponsibility,
  type ReportTemplate,
} from './schema';

export function creatorResponsibility(
  creator: ReportDocument['creator']
): ReportResponsibility {
  return {
    identity: { kind: 'member', ...creator },
    origin: 'creator_fallback',
    sourceIds: [],
  };
}

export function normalizeReportResponsibility(
  document: ReportDocument,
  creator: ReportDocument['creator']
): ReportDocument {
  const fallback = creatorResponsibility(creator);
  return {
    ...document,
    creator,
    responsibility:
      document.responsibility.origin === 'creator_fallback'
        ? fallback
        : document.responsibility,
    chapters: document.chapters.map(chapter => ({
      ...chapter,
      nodes: chapter.nodes.map(node => ({
        ...node,
        responsibility:
          !node.responsibility ||
          node.responsibility.origin === 'creator_fallback'
            ? fallback
            : node.responsibility,
      })),
    })),
  };
}

export function createReportDocument(input: {
  title: string;
  creator: ReportDocument['creator'];
  period: ReportDocument['period'];
  template: ReportTemplate;
  now: string;
}): ReportDocument {
  return ReportDocumentSchema.parse({
    schemaVersion: 'localmind-report/v1',
    title: input.title,
    creator: input.creator,
    responsibility: creatorResponsibility(input.creator),
    period: input.period,
    audience: input.template.audience,
    language: input.template.language,
    durationMinutes: input.template.durationMinutes,
    theme: input.template.theme,
    chapters: input.template.chapters.map(chapter => ({
      id: chapter.key,
      title: chapter.title,
      layout: chapter.layout,
      notes: '',
      nodes: [],
    })),
    assets: input.template.assets,
    sources: [],
    issues: [],
    cutoffAt: input.now,
    coverage: {
      discovered: 0,
      selected: 0,
      read: 0,
      parsed: 0,
      failed: 0,
      omitted: 0,
    },
  });
}

export function reportNodeText(node: ReportNode): string {
  switch (node.type) {
    case 'heading':
    case 'paragraph':
    case 'callout':
      return node.text;
    case 'list':
      return node.items.join('\n');
    case 'table':
      return [node.columns, ...node.rows]
        .map(row => row.join(' | '))
        .join('\n');
    case 'metric':
      return `${node.label}: ${node.value ?? '—'} ${node.unit}`;
    case 'timeline':
      return node.entries
        .map(entry => `${entry.date} ${entry.title}: ${entry.detail}`)
        .join('\n');
    case 'image':
      return [node.alt, node.caption].filter(Boolean).join('\n');
    case 'chart':
      return `${node.title}\n${node.labels.join(' | ')}\n${node.series.map(series => `${series.label}: ${series.values.map(value => value ?? '—').join(' | ')}`).join('\n')}`;
    case 'pageBreak':
      return '';
  }
}

export function reportFinalizationIssues(
  document: ReportDocument,
  automatic = false
): string[] {
  const errors = document.issues
    .filter(
      issue =>
        !issue.resolution ||
        ['invalid_reference', 'missing_asset'].includes(issue.kind)
    )
    .map(issue => issue.id);
  if (
    !document.chapters.some(chapter => !chapter.hidden && chapter.nodes.length)
  )
    errors.push('empty_report');
  if (
    automatic &&
    (document.coverage.failed > 0 ||
      document.coverage.omitted > 0 ||
      document.coverage.parsed < document.coverage.selected)
  )
    errors.push('incomplete_coverage');
  return errors;
}
