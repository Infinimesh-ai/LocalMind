import { applyPlanOps } from '@localmind/office/report-deck';
import { V4_PLAN } from '@localmind/office/report-deck/web-v4.fixture';
import test from 'ava';

import {
  chapterCountErrors,
  requestedChapterCount,
} from '../../plugins/copilot/report-web-design/chapter-constraint';

test('only explicit owner chapter commands freeze a count', t => {
  for (const text of [
    '用3个章节呈现经营结果、风险与行动',
    '分为三章',
    '必须十二章',
    'Use exactly 3 chapters',
    'chapter count: 3',
  ])
    t.is(requestedChapterCount(text), text.includes('十二') ? 12 : 3);
  for (const text of [
    '第3章写风险',
    '3个图表',
    '不要用3章',
    'do not use 3 chapters',
    '用3章或用4章',
    '材料很短',
    '用20章',
  ])
    t.is(requestedChapterCount(text), undefined);
});

test('structural repairs cannot merge away the explicit count; unconstrained plans still can', t => {
  const plan = structuredClone(V4_PLAN);
  t.is(plan.chapters.length, 3);
  const merged = applyPlanOps(plan, [
    {
      op: 'mergeChapters',
      into: plan.chapters[0].id,
      from: plan.chapters[1].id,
    },
  ]).plan;
  t.is(merged.chapters.length, 2);
  t.is(chapterCountErrors('用3个章节呈现', merged.chapters.length).length, 1);
  t.deepEqual(chapterCountErrors('用3个章节呈现', plan.chapters.length), []);
  t.deepEqual(chapterCountErrors(undefined, merged.chapters.length), []);
});
