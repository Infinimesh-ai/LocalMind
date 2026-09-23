import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { createNativeFile } from './create';
import { openDocxPackage, readDocxSemanticState } from './docx';
import { openPptxPackage, readPptxSemanticState } from './pptx';
import { openXlsxPackage, readXlsxSemanticState } from './xlsx';

describe('native file creation', () => {
  it('creates deterministic DOCX paragraphs with escaped Unicode and headings', () => {
    const input = {
      format: 'docx' as const,
      paragraphs: [
        { text: '你好 <&> "世界"', heading: 2 },
        { text: '第一行\n第二行' },
      ],
    };
    const generated = createNativeFile(input);
    expect(generated.bytes).toEqual(createNativeFile(input).bytes);
    const state = readDocxSemanticState(openDocxPackage(generated.bytes));
    expect(JSON.stringify(state)).toContain('你好 <&>');
    expect(JSON.stringify(state)).toContain('Heading2');
    expect(JSON.stringify(state)).toContain('第二行');
  });

  it('preserves workbook cell types, empty cells and literal formula-like strings', () => {
    const generated = createNativeFile({
      format: 'xlsx',
      sheets: [
        { name: '预算 & 计划', rows: [['收入', '=1+1', true, null, 12.5]] },
        { name: '汇总', rows: [[42]] },
      ],
    });
    const state = readXlsxSemanticState(openXlsxPackage(generated.bytes));
    expect(state.sheets.map(s => s.name)).toEqual(['预算 & 计划', '汇总']);
    expect(state.sheets[0].cells.map(c => c.value)).toEqual([
      '收入',
      '=1+1',
      true,
      12.5,
    ]);
    expect(state.sheets[0].cells.every(c => !c.formula)).toBe(true);
  });

  it('creates editable multi-slide PPTX packages with layout relationships', () => {
    const generated = createNativeFile({
      format: 'pptx',
      slides: [
        { title: '开始 & <计划>', paragraphs: ['第一项', '第二项'] },
        { title: '结束', paragraphs: [] },
      ],
    });
    const state = readPptxSemanticState(openPptxPackage(generated.bytes));
    expect(state.slides).toHaveLength(2);
    expect(state.slides[0].shapes.map(s => s.text).join('\n')).toContain(
      '第一项'
    );
    expect(state.slides[0].shapes.map(s => s.text).join('\n')).toContain(
      '开始 & <计划>'
    );
    expect(
      unzipSync(generated.bytes)['ppt/slideLayouts/slideLayout1.xml']
    ).toBeDefined();
  });

  it('writes UTF-8 text, Markdown, JSON and escaped CSV without changing content', () => {
    for (const format of ['txt', 'md', 'json'] as const) {
      const text = '{"内容":"测试"}';
      expect(strFromU8(createNativeFile({ format, text }).bytes)).toBe(text);
    }
    expect(
      strFromU8(
        createNativeFile({
          format: 'csv',
          rows: [['a,b', 'a"b', 'a\nb', 42, null]],
        }).bytes
      )
    ).toBe('"a,b","a""b","a\nb","42",""');
  });

  it('rejects invalid JSON, duplicate sheets, XML controls and oversized inputs', () => {
    expect(() => createNativeFile({ format: 'json', text: '{' })).toThrow();
    expect(() =>
      createNativeFile({
        format: 'xlsx',
        sheets: [
          { name: 'A', rows: [] },
          { name: 'a', rows: [] },
        ],
      })
    ).toThrow('unique');
    expect(() =>
      createNativeFile({ format: 'docx', paragraphs: [{ text: '\u0000' }] })
    ).toThrow();
    expect(() =>
      createNativeFile({
        format: 'docx',
        paragraphs: Array.from({ length: 20 }, () => ({
          text: 'a'.repeat(64000),
        })),
      })
    ).toThrow('1 MiB');
  });
});
