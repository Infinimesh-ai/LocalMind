import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PdfTransformer,
  PptxTransformer,
  XlsxTransformer,
} from '@blocksuite/affine/widgets/linked-doc';
import * as fflate from 'fflate';
import { describe, expect, test, vi } from 'vitest';

function officeFile(
  name: string,
  type: string,
  entries: Record<string, string>
) {
  const bytes = fflate.zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, content]) => [
        path,
        fflate.strToU8(content),
      ])
    )
  );
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type });
}

function parseHtml(html: string) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function fixtureFile(path: string, name: string, type: string) {
  const source = readFileSync(resolve(process.cwd(), path));
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return new File([bytes.buffer], name, { type });
}

function blankPdfFile() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  pdf += offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new File([pdf], 'scan.pdf', { type: 'application/pdf' });
}

describe('Office and PDF import transformers', () => {
  test('converts XLSX worksheets, values, formulas, and dates to HTML tables', async () => {
    const file = officeFile(
      'budget.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      {
        '[Content_Types].xml': '<Types/>',
        'xl/workbook.xml': `
          <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <workbookPr/>
            <sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets>
          </workbook>`,
        'xl/_rels/workbook.xml.rels': `
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
          </Relationships>`,
        'xl/sharedStrings.xml': `
          <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <si><t>Category</t></si><si><t>Revenue</t></si>
          </sst>`,
        'xl/styles.xml': `
          <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>
          </styleSheet>`,
        'xl/worksheets/sheet1.xml': `
          <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
            <sheetData>
              <row r="1">
                <c r="A1" t="s"><v>0</v></c>
                <c r="B1" t="s"><v>1</v></c>
                <c r="C1" t="inlineStr"><is><t>Merged total</t></is></c>
              </row>
              <row r="2">
                <c r="A2" t="inlineStr"><is><t>Subscriptions</t></is></c>
                <c r="B2"><f>SUM(B3:B4)</f><v>10</v></c>
                <c r="C2" s="1"><v>45292</v></c>
                <c r="D2" s="1"/>
              </row>
            </sheetData>
            <mergeCells count="1"><mergeCell ref="C1:D1"/></mergeCells>
          </worksheet>`,
      }
    );

    const result = await XlsxTransformer.parseXlsxToHtml(file);
    const document = parseHtml(result.html);

    expect(result.fileName).toBe('budget');
    expect(document.querySelector('h2')?.textContent).toBe('Budget');
    expect(
      Array.from(document.querySelectorAll('td')).map(cell => cell.textContent)
    ).toEqual([
      'Category',
      'Revenue',
      'Merged total',
      'Subscriptions',
      '10',
      '2024-01-01',
      '',
    ]);
    expect(document.querySelector('td[colspan="2"]')?.textContent).toBe(
      'Merged total'
    );
  });

  test('converts PPTX slide titles, body text, and tables to HTML', async () => {
    const file = officeFile(
      'quarterly-plan.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      {
        '[Content_Types].xml': '<Types/>',
        'ppt/presentation.xml': `
          <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst>
          </p:presentation>`,
        'ppt/_rels/presentation.xml.rels': `
          <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
            <Relationship Id="rId1" Target="slides/slide1.xml"/>
          </Relationships>`,
        'ppt/slides/slide1.xml': `
          <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <p:cSld><p:spTree>
              <p:sp>
                <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
                <p:txBody><a:p><a:r><a:t>Quarterly plan</a:t></a:r></a:p></p:txBody>
              </p:sp>
              <p:sp>
                <p:txBody><a:p><a:r><a:t>Launch in October</a:t></a:r></a:p></p:txBody>
              </p:sp>
              <p:graphicFrame><a:graphic><a:graphicData><a:tbl>
                <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Owner</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>Lin</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
              </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
            </p:spTree></p:cSld>
          </p:sld>`,
      }
    );

    const result = await PptxTransformer.parsePptxToHtml(file);
    const document = parseHtml(result.html);

    expect(result.fileName).toBe('quarterly-plan');
    expect(document.querySelector('h2')?.textContent).toBe('Quarterly plan');
    expect(document.querySelector('p')?.textContent).toBe('Launch in October');
    expect(
      Array.from(document.querySelectorAll('td')).map(cell => cell.textContent)
    ).toEqual(['Owner', 'Lin']);
  });

  test('rejects an Office ZIP without the required package structure', async () => {
    const file = officeFile('invalid.xlsx', 'application/zip', {
      'notes.txt': 'not an Office file',
    });

    await expect(XlsxTransformer.parseXlsxToHtml(file)).rejects.toThrow(
      'not a valid Excel workbook'
    );
  });

  test('converts a text-based PDF into editable HTML content', async () => {
    const file = fixtureFile(
      'tests/fixtures/lorem-ipsum.pdf',
      'research-notes.pdf',
      'application/pdf'
    );

    const result = await PdfTransformer.parsePdfToHtml(file);
    const document = parseHtml(result.html);

    expect(result.fileName).toBe('research-notes');
    expect(result.pageCount).toBe(3);
    expect(result.emptyPageNumbers).toEqual([]);
    expect(document.querySelectorAll('hr')).toHaveLength(2);
    expect(document.body.textContent).toContain(
      'Lorem ipsum odor amet, consectetuer adipiscing elit.'
    );
    expect(document.querySelectorAll('p').length).toBeGreaterThan(0);
  });

  test('requires OCR when a PDF has no extractable text layer', async () => {
    await expect(PdfTransformer.parsePdfToHtml(blankPdfFile())).rejects.toThrow(
      'OCR is required'
    );
  });

  test('converts a scanned PDF page through an injected OCR service', async () => {
    const ocrPage = vi.fn(async () => '# Scanned receipt\n\nTotal: 42');
    const renderOcrPage = vi.fn(
      async () => new Blob(['jpeg'], { type: 'image/jpeg' })
    );

    const result = await PdfTransformer.parsePdfToMarkdown(blankPdfFile(), {
      ocrPage,
      renderOcrPage,
    });

    expect(result.markdown).toContain('# Scanned receipt');
    expect(result.markdown).toContain('Total: 42');
    expect(result.ocrPageNumbers).toEqual([1]);
    expect(result.failedOcrPageNumbers).toEqual([]);
    expect(renderOcrPage).toHaveBeenCalledOnce();
    expect(ocrPage).toHaveBeenCalledWith({
      pageNumber: 1,
      image: expect.objectContaining({ type: 'image/jpeg' }),
    });
  });

  test('rejects a scanned PDF when OCR returns no readable text', async () => {
    await expect(
      PdfTransformer.parsePdfToMarkdown(blankPdfFile(), {
        ocrPage: async () => '',
        renderOcrPage: async () => new Blob(['jpeg'], { type: 'image/jpeg' }),
      })
    ).rejects.toThrow('OCR did not detect readable text');
  });

  test('rejects a file without a PDF header', async () => {
    const file = new File(['not a PDF'], 'invalid.pdf', {
      type: 'application/pdf',
    });

    await expect(PdfTransformer.parsePdfToHtml(file)).rejects.toThrow(
      'not a valid PDF document'
    );
  });
});
