import { strToU8, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, test } from 'vitest';

import { applyDocxCommand } from './edit';
import { exportDocxStateToPdf } from './export-pdf';
import { openDocxPackage } from './package';
import { readDocxSemanticState } from './semantic';

const DOCUMENT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

function minimalDocx(extras: Record<string, Uint8Array> = {}) {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(`
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Default Extension="bin" ContentType="application/octet-stream"/>
          <Override PartName="/word/document.xml" ContentType="${DOCUMENT_CONTENT_TYPE}"/>
        </Types>`),
      '_rels/.rels': strToU8(`
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
        </Relationships>`),
      'word/_rels/document.xml.rels': strToU8(`
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
      'word/document.xml': strToU8(`
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>Hello LocalMind</w:t></w:r></w:p>
            <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
          </w:body>
        </w:document>`),
      ...extras,
    },
    { level: 6 }
  );
}

function documentWithoutSection() {
  return strToU8(`
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Hello LocalMind</w:t></w:r></w:p>
      </w:body>
    </w:document>`);
}

function base(operation: string) {
  return {
    version: 'localmind-office-command/v1' as const,
    commandId: operation,
    idempotencyKey: operation,
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'user' as const,
  };
}

describe('native DOCX editing', () => {
  test('creates a native section break and a previously missing header', () => {
    const initial = openDocxPackage(minimalDocx());
    const paragraph = readDocxSemanticState(initial).body[0];
    expect(paragraph?.type).toBe('paragraph');
    if (paragraph?.type !== 'paragraph') return;

    const sectioned = applyDocxCommand(initial, {
      ...base('section'),
      operation: 'office.document.section.insert',
      target: { type: 'paragraph', blockId: paragraph.id },
      sectionType: 'continuous',
      sourceSectionIndex: 0,
    });
    expect(sectioned.state.sections).toHaveLength(2);
    expect(sectioned.state.sections[0].type).toBe('continuous');

    const header = applyDocxCommand(openDocxPackage(sectioned.packageBytes), {
      ...base('header'),
      operation: 'office.document.header_footer.text.set',
      sectionIndex: 1,
      storyKind: 'header',
      storyType: 'default',
      text: 'Native header',
    });
    expect(header.state.stories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'header', type: 'default' }),
      ])
    );
    expect(
      header.state.stories
        .flatMap(story => story.blocks)
        .some(
          block => block.type === 'paragraph' && block.text === 'Native header'
        )
    ).toBe(true);
  });

  test('creates final section properties when page layout has no section', () => {
    const initial = openDocxPackage(
      minimalDocx({ 'word/document.xml': documentWithoutSection() })
    );
    expect(readDocxSemanticState(initial).sections).toHaveLength(0);

    const result = applyDocxCommand(initial, {
      ...base('layout-without-section'),
      operation: 'office.document.page.layout.set',
      sectionIndex: 0,
      layout: {
        widthPt: 842,
        heightPt: 595,
        orientation: 'landscape',
        marginLeftPt: 36,
      },
    });

    expect(result.state.sections).toEqual([
      expect.objectContaining({
        index: 0,
        pageSize: {
          widthPt: 842,
          heightPt: 595,
          orientation: 'landscape',
        },
        margins: { leftPt: 36 },
      }),
    ]);
  });

  test('enables first and even page stories in native section settings', () => {
    const initial = openDocxPackage(
      minimalDocx({ 'word/document.xml': documentWithoutSection() })
    );
    const first = applyDocxCommand(initial, {
      ...base('first-header'),
      operation: 'office.document.header_footer.text.set',
      sectionIndex: 0,
      storyKind: 'header',
      storyType: 'first',
      text: 'First page',
    });
    expect(first.state.sections[0]).toEqual(
      expect.objectContaining({ titlePage: true })
    );
    expect(first.state.stories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'header', type: 'first' }),
      ])
    );

    const even = applyDocxCommand(openDocxPackage(first.packageBytes), {
      ...base('even-footer'),
      operation: 'office.document.header_footer.text.set',
      sectionIndex: 0,
      storyKind: 'footer',
      storyType: 'even',
      text: 'Even pages',
    });
    const reopened = openDocxPackage(even.packageBytes);
    const settingsPart = reopened
      .getRelationships(reopened.documentPart)
      .find(relationship =>
        relationship.type.endsWith('/settings')
      )?.resolvedTarget;
    expect(settingsPart).toBeTruthy();
    expect(
      new TextDecoder().decode(reopened.requirePart(settingsPart!))
    ).toContain('evenAndOddHeaders');
    expect(even.state.stories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'footer', type: 'even' }),
      ])
    );
  });

  test.each([
    {
      name: 'image',
      object: {
        type: 'image' as const,
        mimeType: 'image/png' as const,
        dataBase64: 'iVBORw0KGgo=',
        widthPt: 120,
        heightPt: 80,
        name: 'Native image',
      },
      partPattern: /^word\/media\/image\d+\.png$/,
    },
    {
      name: 'shape',
      object: {
        type: 'shape' as const,
        shape: 'roundedRectangle' as const,
        widthPt: 120,
        heightPt: 60,
        text: 'Native shape',
        fillColor: '#DCEBFF',
        lineColor: '#245BDB',
      },
    },
    {
      name: 'equation',
      object: { type: 'equation' as const, linearText: 'x^2+y^2=z^2' },
    },
    {
      name: 'chart',
      object: {
        type: 'chart' as const,
        chartType: 'column' as const,
        title: 'Quarterly revenue',
        categories: ['Q1', 'Q2'],
        series: [{ name: 'Revenue', values: [12, 18] }],
        widthPt: 300,
        heightPt: 180,
      },
      partPattern: /^word\/charts\/chart\d+\.xml$/,
    },
  ])('inserts a native $name object and preserves opaque parts', fixture => {
    const opaque = new Uint8Array([1, 3, 3, 7]);
    const initial = openDocxPackage(
      minimalDocx({ 'custom/opaque.bin': opaque })
    );
    const paragraph = readDocxSemanticState(initial).body[0];
    expect(paragraph?.type).toBe('paragraph');
    if (paragraph?.type !== 'paragraph') return;

    const result = applyDocxCommand(initial, {
      ...base(`object-${fixture.name}`),
      operation: 'office.document.object.insert',
      target: { blockId: paragraph.id, offset: 5 },
      object: fixture.object,
    });
    expect(result.state.stats.objects).toBe(1);
    const reopened = openDocxPackage(result.packageBytes);
    expect(reopened.readPart('custom/opaque.bin')).toEqual(opaque);
    if (fixture.partPattern) {
      expect(
        reopened.listParts().some(part => fixture.partPattern?.test(part.path))
      ).toBe(true);
    }
  });

  test('exports document pages to a readable PDF', async () => {
    const pkg = openDocxPackage(minimalDocx());
    const state = readDocxSemanticState(pkg);
    const bytes = await exportDocxStateToPdf(state, {
      title: 'Native export',
      readPart: part => pkg.readPart(part),
    });
    expect(new TextDecoder('ascii').decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('Native export');
  });
});
