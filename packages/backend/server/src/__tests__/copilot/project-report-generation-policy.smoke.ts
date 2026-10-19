import assert from 'node:assert/strict';

import {
  BUILTIN_REPORT_TEMPLATES,
  createReportDocument,
  reportFinalizationIssues,
  ReportSourceSchema,
} from '@localmind/office/report';

import { workOrderEvidenceText } from '../../models/project-report-generation-contract';
import { ReportScheduleConfigSchema } from '../../models/project-report-schedule-contract';
import { reportDeliveryIntersection } from '../../models/project-report-schedule-policy';
import {
  reportScheduleNext,
  reportSchedulePeriod,
} from '../../models/project-report-schedule-time';
import { compareReportEvidence } from '../../plugins/copilot/report-comparison';
import {
  assertReportEvidenceUnchanged,
  groundReportFacts,
  makeReportEvidenceDocument,
  reportFactNode,
  reportWorkOrderState,
} from '../../plugins/copilot/report-generation-policy';

const source = ReportSourceSchema.parse({
  id: 'source',
  resourceId: 'doc',
  kind: 'file',
  title: '进度',
  revision: 'revision',
  locator: 'File body',
  fingerprint: 'a'.repeat(64),
  capturedAt: '2026-10-08T00:00:00Z',
  status: 'parsed',
});
const snapshot = {
  source,
  text: '负责人 Alice。计划下周交付。',
  changedInPeriod: true,
  historicalGap: false,
  truncated: false,
};
const grounding = groundReportFacts(
  {
    facts: [
      {
        sourceId: 'source',
        quote: '计划下周交付。',
        statement: 'Already delivered',
        kind: 'plan',
        state: 'planned',
        owner: { label: 'Mallory', quote: 'Alice' },
      },
      {
        sourceId: 'private-chat',
        quote: '计划下周交付。',
        statement: 'Private progress',
        kind: 'progress',
        state: 'completed',
      },
      {
        sourceId: 'source',
        quote: '所有工作完成',
        statement: 'Everything completed',
        kind: 'progress',
        state: 'completed',
      },
    ],
  },
  snapshot,
  snapshot.text
);
assert.equal(grounding.facts.length, 1);
assert.equal(grounding.rejected, 3);
assert.equal(grounding.facts[0]!.statement, '计划下周交付。');
assert.equal(grounding.facts[0]!.owner, undefined);
const backgroundGrounding = groundReportFacts(
  {
    facts: [
      {
        sourceId: 'memory',
        quote: '计划下周交付。',
        statement: 'Someone completed work',
        kind: 'progress',
        state: 'completed',
      },
    ],
  },
  { ...snapshot, source: { ...source, id: 'memory', kind: 'memory' } },
  snapshot.text
);
assert.equal(backgroundGrounding.facts.length, 0);
assert.equal(backgroundGrounding.rejected, 1);
const workOrderText = workOrderEvidenceText({
  id: 'order',
  title: '接口验收',
  role: 'recipient',
  status: 'open',
  version: 2,
  requirementTitles: ['验收报告'],
  delivery: null,
  completedAt: null,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
  revision: 'open:2:0',
  fingerprint: 'b'.repeat(64),
});
const workOrderSnapshot = {
  ...snapshot,
  text: workOrderText,
  source: {
    ...source,
    id: 'order-source',
    kind: 'work_order' as const,
    revision: 'open:2:0',
  },
};
const statusQuote = '工单「接口验收」当前状态：进行中。';
assert(workOrderText.includes(statusQuote));
const workOrderGrounding = groundReportFacts(
  {
    facts: [
      {
        sourceId: 'order-source',
        quote: statusQuote,
        statement: 'Already completed',
        kind: 'progress',
        state: 'completed',
        owner: { label: '接口验收', quote: statusQuote },
      },
      {
        sourceId: 'order-source',
        quote: statusQuote,
        statement: 'Delivered',
        kind: 'achievement',
        state: 'completed',
      },
      {
        sourceId: 'order-source',
        quote: '必需要求：验收报告。',
        statement: 'Project goal',
        kind: 'goal',
        state: 'unknown',
      },
    ],
  },
  workOrderSnapshot,
  workOrderText
);
assert.equal(workOrderGrounding.facts.length, 1);
// Model state is replaced by the recorded status; owner is never inferred.
assert.equal(workOrderGrounding.facts[0]!.state, 'in_progress');
assert.equal(workOrderGrounding.facts[0]!.owner, undefined);
assert.equal(workOrderGrounding.rejected, 3);
for (const [revision, state] of [
  ['delivered:3:1', 'completed'],
  ['validating:2:1', 'in_progress'],
  ['waiting_sender:2:1', 'blocked'],
  ['refused:2:0', 'blocked'],
  ['cancelled:2:0', 'unknown'],
] as const)
  assert.equal(reportWorkOrderState(revision), state);
const deliveredText = workOrderEvidenceText(
  {
    id: 'order',
    title: '接口验收',
    role: 'sender',
    status: 'delivered',
    version: 3,
    requirementTitles: ['验收报告'],
    delivery: {
      revision: 1,
      submittedAt: '2026-10-04T00:00:00.000Z',
      itemCount: 1,
    },
    completedAt: '2026-10-04T00:00:00.000Z',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
    revision: 'delivered:3:1',
    fingerprint: 'c'.repeat(64),
  },
  'en'
);
assert(deliveredText.includes('Latest delivery revision 1'));
const deliveredGrounding = groundReportFacts(
  {
    facts: [
      {
        sourceId: 'order-source',
        quote: 'Work order "接口验收" status: delivered (completed).',
        statement: 'Delivered',
        kind: 'achievement',
        state: 'in_progress',
      },
    ],
  },
  {
    ...workOrderSnapshot,
    text: deliveredText,
    source: { ...workOrderSnapshot.source, revision: 'delivered:3:1' },
  },
  deliveredText
);
assert.equal(deliveredGrounding.facts[0]!.state, 'completed');
const businessNode = reportFactNode(
  deliveredGrounding.facts,
  { actorId: 'report-creator', label: '创建人' },
  undefined,
  'progress',
  new Set(['order-source'])
);
assert.equal(businessNode.claimKind, 'business_state');
assert.equal(businessNode.responsibility?.origin, 'creator_fallback');
const creator = { actorId: 'report-creator', label: '创建人' };
const node = reportFactNode(grounding.facts, creator);
assert.equal(node.responsibility?.origin, 'creator_fallback');
assert.deepEqual(node.responsibility?.identity, {
  kind: 'member',
  actorId: creator.actorId,
  label: creator.label,
});
assert.equal(node.claimKind, 'document');
const achievement = reportFactNode(
  grounding.facts,
  creator,
  undefined,
  'achievements'
);
const risk = reportFactNode(grounding.facts, creator, undefined, 'risks');
assert.notEqual(achievement.id, risk.id);
assert.equal(
  achievement.id,
  reportFactNode(
    [...grounding.facts].reverse(),
    creator,
    undefined,
    'achievements'
  ).id
);
assert.deepEqual(achievement.sourceIds, risk.sourceIds);
assert.equal(
  reportFactNode(grounding.facts, creator, '预计能按时交付').claimKind,
  'inference'
);
const base = createReportDocument({
  title: '周报',
  creator,
  template: BUILTIN_REPORT_TEMPLATES[0]!.content,
  period: {
    start: '2026-10-01T00:00:00Z',
    end: '2026-10-08T00:00:00Z',
    timeZone: 'UTC',
    weekStartsOn: 1,
  },
  now: '2026-10-08T00:00:00Z',
});
const doc = makeReportEvidenceDocument(
  base,
  [{ ...snapshot, historicalGap: true, truncated: true }],
  {
    discovered: 3,
    enumerationComplete: false,
    cutoffAt: '2026-10-08T00:00:00Z',
  }
);
assert(doc.issues.some(i => i.kind === 'time_gap'));
assert(doc.issues.some(i => i.kind === 'coverage'));
assert(reportFinalizationIssues(doc, true).length > 0);
assert.throws(() => assertReportEvidenceUnchanged({ ...doc, issues: [] }, doc));
assert.throws(() =>
  assertReportEvidenceUnchanged(
    { ...doc, coverage: { ...doc.coverage, discovered: 100 } },
    doc
  )
);
const prior = structuredClone(base);
prior.sources = [source];
prior.chapters[0]!.nodes = [node];
const current = structuredClone(base);
current.sources = [{ ...source, id: 'new-source', revision: 'next-revision' }];
const continued = compareReportEvidence(prior, current, [
  { ...grounding.facts[0]!, sourceId: 'new-source' },
]);
assert.equal(continued.nodes[0]!.claimKind, 'inference');
assert(JSON.stringify(continued.nodes).includes('延续记录'));
const changed = compareReportEvidence(prior, current, [
  { ...grounding.facts[0]!, sourceId: 'new-source', quote: '完成两项验收。' },
]);
assert(JSON.stringify(changed.nodes).includes('同一来源记录变化'));
current.sources[0]!.resourceId = 'different-document-same-title';
const unrelated = compareReportEvidence(prior, current, [
  { ...grounding.facts[0]!, sourceId: 'new-source' },
]);
assert(JSON.stringify(unrelated.nodes).includes('无可唯一对应'));
assert(JSON.stringify(unrelated.nodes).includes('不代表完成或取消'));
assert.throws(() =>
  assertReportEvidenceUnchanged(
    { ...doc, sources: [{ ...source, revision: 'forged' }] },
    doc
  )
);
const config = ReportScheduleConfigSchema.parse({
  title: 'Weekly',
  templateRevisionId: 'template',
  selection: { kind: 'all' },
  timeZone: 'America/New_York',
  frequency: 'weekly',
  day: 7,
  time: '02:30',
  period: 'previous_week',
  autoFinalize: true,
  delivery: {
    enabled: true,
    channel: 'email',
    recipients: ['a@example.com', 'b@example.com'],
    includeAttachment: true,
    expiresDays: 7,
    audience: {
      kind: 'external',
      chapterIds: ['one', 'two'],
      includeNotes: false,
      includeSources: true,
    },
  },
});
assert.equal(
  reportScheduleNext(
    config,
    new Date('2026-03-07T00:00:00Z')
  ).instant.toISOString(),
  '2026-03-08T07:30:00.000Z'
);
const fall = { ...config, time: '01:30' };
assert.equal(
  reportScheduleNext(
    fall,
    new Date('2026-10-31T00:00:00Z')
  ).instant.toISOString(),
  '2026-11-01T05:30:00.000Z'
);
assert.equal(
  reportScheduleNext(
    fall,
    new Date('2026-11-01T05:30:00Z')
  ).instant.toISOString(),
  '2026-11-08T06:30:00.000Z'
);
const month = {
  ...config,
  frequency: 'monthly' as const,
  day: 31,
  time: '09:00',
};
assert.equal(
  reportScheduleNext(month, new Date('2026-02-01T00:00:00Z')).nominal,
  '2026-02-28T09:00'
);
const period = reportSchedulePeriod(config, new Date('2026-03-09T12:00:00Z'));
assert.equal(period.start, '2026-03-02T05:00:00.000Z');
assert.equal(period.end, '2026-03-09T04:00:00.000Z');
assert.equal((+new Date(period.end) - +new Date(period.start)) / 3600000, 167);
const intersection = reportDeliveryIntersection(config, {
  ...config,
  delivery: {
    ...config.delivery,
    recipients: ['b@example.com', 'new@example.com'],
    includeAttachment: false,
    audience: {
      ...config.delivery.audience,
      chapterIds: ['two', 'new'],
      includeSources: false,
    },
  },
});
assert.deepEqual(intersection?.recipients, ['b@example.com']);
assert.deepEqual(intersection?.audience.chapterIds, ['two']);
assert.equal(intersection?.includeAttachment, false);
assert.equal(intersection?.audience.includeSources, false);
assert.equal(
  reportDeliveryIntersection(config, {
    ...config,
    delivery: { ...config.delivery, enabled: false },
  }),
  null
);
console.log('Project report generation/schedule evidence policy smoke: passed');
