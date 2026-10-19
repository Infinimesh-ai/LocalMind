import type { ReportDocument, ReportNode } from '@localmind/office/report';

import {
  type GroundedReportFact,
  reportStableId,
} from './report-generation-policy';

/** Compare immutable source identities and exact text; similar names never establish identity. */
export function compareReportEvidence(
  previous: ReportDocument,
  current: ReportDocument,
  facts: GroundedReportFact[]
) {
  const oldSources = new Map(
    previous.sources.map(source => [source.id, source])
  );
  const currentSources = new Map(
    current.sources.map(source => [source.id, source])
  );
  const prior = previous.chapters
    .flatMap(chapter => chapter.nodes)
    .filter(
      (node): node is Extract<ReportNode, { type: 'paragraph' }> =>
        node.type === 'paragraph' && node.claimKind === 'document'
    );
  const rows: Array<{ cells: string[]; sources: string[] }> = [];
  const matched = new Set<string>();
  for (const fact of facts) {
    const source = currentSources.get(fact.sourceId);
    if (!source) continue;
    const candidates = prior.filter(node =>
      node.sourceIds.some(
        id => oldSources.get(id)?.resourceId === source.resourceId
      )
    );
    const exact = candidates.find(node => node.text === fact.quote);
    const previousNode =
      exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (previousNode) matched.add(previousNode.id);
    const category = exact
      ? '延续记录'
      : previousNode
        ? '同一来源记录变化（请核对业务状态）'
        : fact.kind === 'risk'
          ? '本期新增风险记录'
          : fact.kind === 'plan'
            ? '本期新增计划记录'
            : fact.kind === 'achievement'
              ? '本期新增成果记录'
              : '本期新增文档记录';
    rows.push({
      cells: [
        category,
        previousNode?.text ?? '无可唯一对应的上期原文',
        fact.quote,
        previousNode
          ? `${previousNode.sourceIds.map(id => oldSources.get(id)?.revision ?? '').join(', ')} → ${source.revision}`
          : `本期来源版本 ${source.revision}`,
      ],
      sources: [
        ...new Set([fact.sourceId, ...(previousNode?.sourceIds ?? [])]),
      ],
    });
  }
  for (const node of prior)
    if (!matched.has(node.id))
      rows.push({
        cells: [
          '本次未匹配',
          '' + node.text,
          '本次范围未出现，不代表完成或取消',
          '需查阅原始文档核对',
        ],
        sources: node.sourceIds,
      });
  const nodes: ReportNode[] = [];
  let omitted = 0;
  let cells: string[][] = [],
    sources = new Set<string>();
  const flush = () => {
    if (!cells.length) return;
    nodes.push({
      id: reportStableId(['period-comparison', cells]),
      type: 'table',
      columns: ['比较分类', '上期原文', '本期原文', '依据版本'],
      rows: cells,
      sourceIds: [...sources],
      claimKind: 'inference',
      locked: false,
    });
    cells = [];
    sources = new Set();
  };
  for (const row of rows) {
    if (nodes.length >= 30 || row.sources.length > 100) {
      omitted++;
      continue;
    }
    if (cells.length >= 25 || new Set([...sources, ...row.sources]).size > 100)
      flush();
    cells.push(row.cells);
    row.sources.forEach(id => sources.add(id));
  }
  flush();
  return { nodes, omitted };
}
