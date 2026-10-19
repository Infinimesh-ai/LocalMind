import type { GraphQLService } from '@affine/core/modules/cloud';
import {
  BUILTIN_REPORT_TEMPLATES,
  createReportDocument,
  projectReportAudience,
} from '@localmind/office/report';
import { expect, it, vi } from 'vitest';

import {
  createProjectReportApi,
  readSharedReport,
  reportAssetUrl,
} from './api';
it('rejects remote or non-report assets instead of requesting arbitrary URLs', () => {
  expect(
    reportAssetUrl(
      '/api/projects/p/reports/r/revisions/v/assets/a',
      'https://localmind.test'
    )
  ).toBe(
    'https://localmind.test/api/projects/p/reports/r/revisions/v/assets/a'
  );
  for (const path of [
    'https://other.test/x',
    '//other.test/x',
    '/api/projects/p/blobs/secret',
    'javascript:alert(1)',
  ])
    expect(() => reportAssetUrl(path, 'https://localmind.test')).toThrow();
});
it('reuses the request key after an uncertain network failure', async () => {
  const gql = vi
    .fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({ projectReportCommand: {} });
  const api = createProjectReportApi(
    { gql } as unknown as Pick<GraphQLService, 'gql'>,
    { fetch: vi.fn() },
    'https://localmind.test'
  );
  const command = { operation: 'lease.acquire' as const, tabId: 'tab' };
  await expect(
    api.command({ projectId: 'project', requestKey: 'first', command })
  ).rejects.toThrow('network');
  await api.command({ projectId: 'project', requestKey: 'second', command });
  expect(
    gql.mock.calls.map(([request]) => request.variables.input.requestKey)
  ).toEqual(['first', 'first']);
});
it('coalesces duplicate pending mutations and allows a deliberate later action', async () => {
  let complete: (value: unknown) => void = () => {};
  const gql = vi.fn(
    () =>
      new Promise(resolve => {
        complete = resolve;
      })
  );
  const api = createProjectReportApi(
    { gql } as unknown as Pick<GraphQLService, 'gql'>,
    { fetch: vi.fn() },
    'https://localmind.test'
  );
  const command = { operation: 'lease.acquire' as const, tabId: 'tab' };
  const one = api.command({
    projectId: 'project',
    requestKey: 'first',
    command,
  });
  const two = api.command({
    projectId: 'project',
    requestKey: 'second',
    command,
  });
  expect(gql).toHaveBeenCalledTimes(1);
  complete({ projectReportCommand: {} });
  await Promise.all([one, two]);
  const later = api.command({
    projectId: 'project',
    requestKey: 'third',
    command,
  });
  expect(gql).toHaveBeenCalledTimes(2);
  complete({ projectReportCommand: {} });
  await later;
});

it('parses the public download map and rejects a forged public download URL', () => {
  const document = createReportDocument({
    title: 'Shared',
    creator: { actorId: 'creator', label: 'Creator' },
    period: {
      start: '2026-10-01T00:00:00Z',
      end: '2026-10-08T00:00:00Z',
      timeZone: 'UTC',
      weekStartsOn: 1,
    },
    template: BUILTIN_REPORT_TEMPLATES[0].content,
    now: '2026-10-08T00:00:00Z',
  });
  const projection = projectReportAudience(document, {
    kind: 'external',
    chapterIds: document.chapters.map(item => item.id),
    includeSources: false,
    includeNotes: false,
  });
  const result = readSharedReport(
    {
      projection,
      assetUrls: {},
      downloads: { pdf: '/api/report-shares/share/downloads/pdf' },
    },
    'https://localmind.test'
  );
  expect(result.downloads.pdf).toBe(
    'https://localmind.test/api/report-shares/share/downloads/pdf'
  );
  expect(() =>
    readSharedReport(
      {
        projection,
        assetUrls: {},
        downloads: { pdf: 'https://other.test/collect' },
      },
      'https://localmind.test'
    )
  ).toThrow();
});
