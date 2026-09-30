import { describe, expect, test } from 'vitest';

import { officeDownloadFileName } from './format';

describe('current Office download names', () => {
  test.each([
    ['中文报告', 'document', '中文报告.docx'],
    ['预算.XLSX', 'workbook', '预算.xlsx'],
    ['演示.pptx', 'presentation', '演示.pptx'],
    ['文档.docx', 'pdf', '文档.pdf'],
    ['审阅.PDF', 'pdf', '审阅.pdf'],
    ['', 'document', 'document.docx'],
  ] as const)('%s (%s)', (title, kind, expected) => {
    expect(officeDownloadFileName(title, kind)).toBe(expected);
  });
});
