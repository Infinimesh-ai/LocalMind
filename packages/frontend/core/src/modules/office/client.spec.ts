/** @vitest-environment happy-dom */
import { createNativeFile } from '@localmind/office';
import { openXlsxPackage, readXlsxSemanticState } from '@localmind/office/xlsx';
import { afterEach, expect, test, vi } from 'vitest';

import {
  downloadOfficePackage,
  fetchOfficeState,
  officeAssetUrl,
  officeWorkbookExportUrl,
  OfficeXlsxCompatibilityUnavailableError,
} from './client';

const originalUrl = window.location.href;

test('workbook reads request the authorized versioned view for legacy calculation states', async () => {
  window.location.href = 'http://localhost:8080/workspace/w/office/a';
  const state = readXlsxSemanticState(
    openXlsxPackage(
      createNativeFile({
        format: 'xlsx',
        sheets: [{ name: 'Budget', rows: [[1]] }],
      }).bytes
    )
  );
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => state });
  vi.stubGlobal('fetch', fetcher);
  await fetchOfficeState(
    '/api/workspaces/w/office/artifacts/a/revisions/r/state',
    'workbook'
  );
  expect(fetcher).toHaveBeenCalledWith(
    'http://localhost:8080/api/workspaces/w/office/artifacts/a/revisions/r/state?view=layout-v2',
    expect.objectContaining({ credentials: 'include' })
  );
});

afterEach(() => {
  window.location.href = originalUrl;
  vi.unstubAllGlobals();
});

test('rewrites authenticated Office assets across local loopback aliases', () => {
  vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, debug: true, isWeb: true });
  window.location.href = 'http://localhost:8080/project/p';

  expect(
    officeAssetUrl(
      'http://0.0.0.0:3025/api/projects/p/office/artifacts/a/revisions/r/state'
    )
  ).toBe(
    'http://localhost:8080/api/projects/p/office/artifacts/a/revisions/r/state'
  );
});

test('does not rewrite non-local or unrecognized asset routes', () => {
  vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, debug: true, isWeb: true });
  window.location.href = 'http://localhost:8080/project/p';

  expect(
    officeAssetUrl(
      'https://assets.example.test/api/projects/p/office/artifacts/a/revisions/r/state'
    )
  ).toBe(
    'https://assets.example.test/api/projects/p/office/artifacts/a/revisions/r/state'
  );
  expect(officeAssetUrl('http://0.0.0.0:3025/api/other/state')).toBe(
    'http://0.0.0.0:3025/api/other/state'
  );
});

test('compatible workbook export retains the selected revision and rewrites only recognized local routes', () => {
  vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, debug: true, isWeb: true });
  window.location.href = 'http://localhost:8080/project/p';
  expect(
    officeWorkbookExportUrl(
      'http://0.0.0.0:3025/api/projects/p/office/artifacts/a/revisions/old/package?unused=1'
    )
  ).toBe(
    'http://localhost:8080/api/projects/p/office/artifacts/a/revisions/old/export/xlsx'
  );
  expect(() => officeWorkbookExportUrl('/api/projects/p/state')).toThrow();
});

test('unsafe repair is an actionable failure, never downloaded as a workbook', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      headers: new Headers({
        'x-localmind-office-error': 'xlsx-compatibility-unavailable',
      }),
    })
  );
  await expect(
    downloadOfficePackage('/export/xlsx', 'copy.xlsx')
  ).rejects.toBeInstanceOf(OfficeXlsxCompatibilityUnavailableError);
});
