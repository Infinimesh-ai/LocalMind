import { getOrCreateI18n } from '@affine/i18n';
import { beforeAll, describe, expect, test } from 'vitest';

import {
  isProjectReportToolName,
  projectReportToolResultView,
} from './report-tool-view';

beforeAll(async () => {
  await getOrCreateI18n().changeLanguage('zh-Hans');
});

describe('Project report tool cards', () => {
  test('recognizes only project report tools', () => {
    expect(isProjectReportToolName('project_report_rewrite')).toBe(true);
    expect(isProjectReportToolName('project_doc_read')).toBe(false);
  });

  test('summarizes a report read with title and chapter count', () => {
    const view = projectReportToolResultView('project_report_read', {
      reportId: 'report-1',
      title: '第三季度汇报',
      chapters: [
        { id: 'c1', title: '进展' },
        { id: 'c2', title: '风险' },
      ],
    });
    expect(view).toEqual({
      status: 'success',
      kind: 'read',
      name: '已读取汇报：第三季度汇报，2 个章节',
      results: [
        { title: '进展', content: '' },
        { title: '风险', content: '' },
      ],
    });
  });

  test('never presents a queued rewrite as applied', () => {
    const view = projectReportToolResultView('project_report_rewrite', {
      status: 'queued',
      applied: false,
      runStatus: 'pending',
      scope: { chapterIds: ['c1'], nodeIds: [], chapterTitles: ['进展'] },
    });
    expect(view.status).toBe('success');
    if (view.status !== 'success') return;
    expect(view.name).toBe('已提交改写');
    expect(view.results[0].title).toBe('范围：进展');
    expect(view.results[0].content).toContain('右侧画布审核');
    expect(view.results[0].content).toContain('pending');
  });

  test('labels whole-report refresh and failures', () => {
    const refresh = projectReportToolResultView('project_report_refresh', {
      status: 'queued',
      scope: { wholeReport: true },
    });
    expect(refresh.status === 'success' && refresh.results[0].title).toBe(
      '范围：整份汇报'
    );
    expect(
      projectReportToolResultView('project_report_rewrite', {
        type: 'error',
        name: 'x',
        message: 'y',
      })
    ).toEqual({ status: 'error', name: '无法提交汇报修改。' });
    expect(projectReportToolResultView('project_report_read', {})).toEqual({
      status: 'error',
      name: '无法读取项目汇报。',
    });
  });
});
