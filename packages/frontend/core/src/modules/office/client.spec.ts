/** @vitest-environment happy-dom */

import { describe, expect, test } from 'vitest';

import { officePackagePartUrl, officePdfExportUrl } from './client';

describe('Office immutable asset URLs', () => {
  const packageUrl =
    'https://localmind.test/api/workspaces/w/office/artifacts/a/revisions/r/package?download=1';

  test('projects a bounded package part URL', () => {
    expect(officePackagePartUrl(packageUrl, 'word/media/image 1.png')).toBe(
      'https://localmind.test/api/workspaces/w/office/artifacts/a/revisions/r/part?path=word%2Fmedia%2Fimage+1.png'
    );
  });

  test('projects a document PDF export URL', () => {
    expect(officePdfExportUrl(packageUrl)).toBe(
      'https://localmind.test/api/workspaces/w/office/artifacts/a/revisions/r/export/pdf'
    );
    expect(() =>
      officePdfExportUrl('https://localmind.test/not-office')
    ).toThrow(/Invalid Office package URL/);
  });
});
