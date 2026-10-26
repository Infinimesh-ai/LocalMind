/** @vitest-environment happy-dom */
import {
  downloadOfficePackage,
  OfficePdfFontUnavailableError,
} from '@affine/core/modules/office/client';
import { UserFriendlyError } from '@affine/error';
import { getOrCreateI18n } from '@affine/i18n';
import type { OfficeSelection } from '@localmind/office';
import { describe, expect, test, vi } from 'vitest';

import {
  isHistoricalOfficeRevision,
  isOfficeSelectionAvailable,
  newestOfficeRevision,
  officeErrorMessage,
} from './shared';

describe('Office error messages', () => {
  test('explains font export limits for Workspace and Project without leaking document text', async () => {
    const i18n = getOrCreateI18n();
    await i18n.changeLanguage('zh-Hans');
    try {
      const error = new OfficePdfFontUnavailableError();
      const expected =
        'PDF 导出暂不支持文档中的部分字符。请下载原生 Office 文件以保留全部内容。';
      expect(officeErrorMessage(error)).toBe(expected);
      expect(
        officeErrorMessage(error, { kind: 'project', projectId: 'project-1' })
      ).toBe(expected);
    } finally {
      await i18n.changeLanguage('en');
    }
  });
  test('recognizes only the bounded font failure status and header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('private document text', {
          status: 422,
          headers: { 'x-localmind-office-error': 'pdf-font-unavailable' },
        })
      )
    );
    try {
      await expect(
        downloadOfficePackage('/office/export/pdf', 'test.pdf')
      ).rejects.toBeInstanceOf(OfficePdfFontUnavailableError);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  test('uses a localized, safe message for internal errors and arbitrary payloads', async () => {
    const i18n = getOrCreateI18n();
    await i18n.changeLanguage('zh-Hans');
    try {
      for (const error of [
        new Error('An internal error occurred.'),
        new Error('DOCX command target offset is outside its paragraph'),
        new Error('/private/server/path secret-request-data'),
        { privateData: 'not for the UI' },
      ]) {
        expect(officeErrorMessage(error)).toBe(
          '操作未完成，请重试。若仍然失败，请联系管理员。'
        );
      }
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  test.each([
    [401, 'editing permission'],
    [403, 'editing permission'],
    [404, 'unavailable'],
    [409, 'newer version'],
    [429, 'Too many requests'],
  ])(
    'explains recovery for status %s without showing server details',
    (status, text) => {
      const error = new UserFriendlyError({
        status,
        name: 'INTERNAL_SERVER_ERROR',
        code: 'test',
        type: 'test',
        message: 'private server details',
      });
      expect(officeErrorMessage(error)).toContain(String(text));
      expect(officeErrorMessage(error)).not.toContain(error.message);
    }
  );
});

describe('isHistoricalOfficeRevision', () => {
  test('uses revision order instead of a temporarily stale current id', () => {
    expect(isHistoricalOfficeRevision({ sequence: 2 }, { sequence: 1 })).toBe(
      true
    );
    expect(isHistoricalOfficeRevision({ sequence: 2 }, { sequence: 2 })).toBe(
      false
    );
    expect(isHistoricalOfficeRevision({ sequence: 2 }, { sequence: 3 })).toBe(
      false
    );
  });
});

describe('newestOfficeRevision', () => {
  test('never lets a history query move the latest pointer backwards', () => {
    const latest = { id: 'revision-7', sequence: 7 };
    expect(newestOfficeRevision(null, latest)).toBe(latest);
    expect(
      newestOfficeRevision(latest, { id: 'revision-6', sequence: 6 })
    ).toBe(latest);
    expect(
      newestOfficeRevision(latest, { id: 'revision-8', sequence: 8 })
    ).toEqual({ id: 'revision-8', sequence: 8 });
  });
});

describe('isOfficeSelectionAvailable', () => {
  test('keeps document text selections only while stable blocks and offsets exist', () => {
    const state = {
      schemaVersion: 'localmind-office-docx-state/v1',
      body: [
        {
          type: 'paragraph',
          id: 'paragraph-1',
          text: 'LocalMind',
          runs: [{ content: [{ type: 'text', text: 'LocalMind' }] }],
          fields: [],
          bookmarks: [],
        },
      ],
      stories: [],
      sections: [],
    } as never;
    const selection = {
      kind: 'document',
      target: {
        type: 'text_range',
        start: { blockId: 'paragraph-1', offset: 0 },
        end: { blockId: 'paragraph-1', offset: 5 },
      },
    } satisfies OfficeSelection;

    expect(isOfficeSelectionAvailable(state, selection)).toBe(true);
    expect(
      isOfficeSelectionAvailable(state, {
        ...selection,
        target: {
          ...selection.target,
          end: { blockId: 'paragraph-1', offset: 50 },
        },
      })
    ).toBe(false);
  });

  test('checks stable workbook, presentation, and PDF targets', () => {
    const workbook = {
      schemaVersion: 'localmind-office-xlsx-state/v1',
      sheets: [
        {
          id: 'sheet-1',
          tables: [{ id: 'table-1' }],
          charts: [{ id: 'chart-1' }],
        },
      ],
    } as never;
    expect(
      isOfficeSelectionAvailable(workbook, {
        kind: 'workbook',
        target: { type: 'cell', sheetId: 'sheet-1', address: 'B2' },
      })
    ).toBe(true);

    const presentation = {
      schemaVersion: 'localmind-office-pptx-state/v1',
      slides: [
        {
          id: 'slide-1',
          shapes: [
            {
              id: 'group-1',
              children: [{ id: 'shape-1', placeholder: { type: 'title' } }],
            },
          ],
        },
      ],
    } as never;
    expect(
      isOfficeSelectionAvailable(presentation, {
        kind: 'presentation',
        target: { type: 'shape', slideId: 'slide-1', shapeId: 'shape-1' },
      })
    ).toBe(true);

    const pdf = {
      schemaVersion: 'localmind-office-pdf-state/v1',
      pages: [{ annotations: [{ id: 'annotation-1' }] }],
      formFields: [{ name: 'CustomerName' }],
    } as never;
    expect(
      isOfficeSelectionAvailable(pdf, {
        kind: 'pdf',
        target: {
          type: 'annotation',
          pageIndex: 0,
          annotationId: 'annotation-1',
        },
      })
    ).toBe(true);
    expect(
      isOfficeSelectionAvailable(pdf, {
        kind: 'pdf',
        target: { type: 'page', pageIndex: 5 },
      })
    ).toBe(false);
  });
});
