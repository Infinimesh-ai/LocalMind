/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { strToU8, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, test } from 'vitest';

import { applyDocxCommand } from './edit';
import { exportDocxStateToPdf } from './export-pdf';
import { openDocxPackage } from './package';
import { docxSectionStory } from './sections';
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
  test('mail merge preserves fields, updates duplicate quoted names and ignores inherited keys', () => {
    const pkg = openDocxPackage(
      minimalDocx({
        'word/document.xml':
          strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:p><w:fldSimple w:instr='MERGEFIELD "Customer Name"'><w:r><w:t>Before</w:t></w:r></w:fldSimple></w:p>
        <w:p><w:fldSimple w:instr='MERGEFIELD "Customer Name"'><w:r><w:t>Before again</w:t></w:r></w:fldSimple></w:p>
        <w:p><w:fldSimple w:instr="MERGEFIELD constructor"><w:r><w:t>Untouched</w:t></w:r></w:fldSimple></w:p>
      </w:body></w:document>`),
      })
    );
    const initial = readDocxSemanticState(pkg);
    expect(
      initial.references.mailMergeFields.map(field => field.argument)
    ).toEqual(['Customer Name', 'Customer Name', 'constructor']);
    expect(
      initial.references.mailMergeFields.every(
        field => field.mailMergeSupported
      )
    ).toBe(true);
    const result = applyDocxCommand(pkg, {
      ...base('merge-fields'),
      operation: 'office.document.mail_merge.apply',
      values: { 'Customer Name': '海棠项目' },
    });
    expect(
      result.state.body.map(block =>
        block.type === 'paragraph' ? block.text : ''
      )
    ).toEqual(['海棠项目', '海棠项目', 'Untouched']);
    expect(result.state.references.mailMergeFields).toEqual(
      initial.references.mailMergeFields
    );
    expect(
      new TextDecoder().decode(
        openDocxPackage(result.packageBytes).requirePart('word/document.xml')
      )
    ).toContain('fldSimple');
  });

  test('mail merge flags complex fields as unsupported for the native form', () => {
    const pkg = openDocxPackage(
      minimalDocx({
        'word/document.xml':
          strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>
        <w:r><w:fldChar w:fldCharType="begin"/></w:r>
        <w:r><w:instrText> MERGEFIELD "Customer Name" </w:instrText></w:r>
        <w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Before</w:t></w:r>
        <w:r><w:fldChar w:fldCharType="end"/></w:r>
      </w:p></w:body></w:document>`),
      })
    );
    expect(readDocxSemanticState(pkg).references.mailMergeFields).toMatchObject(
      [{ argument: 'Customer Name', mailMergeSupported: false }]
    );
  });

  test('AI paragraph insertion creates a separate third paragraph and preserves existing content and identities', () => {
    const opaque = new Uint8Array([9, 8, 7]);
    const pkg = openDocxPackage(
      minimalDocx({
        'custom/opaque.bin': opaque,
        'word/document.xml': strToU8(
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body><w:p w14:paraId="00000001"><w:r><w:rPr><w:b/></w:rPr><w:t>第一段</w:t></w:r></w:p><w:p w14:paraId="00000002"><w:r><w:t>第二段</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`
        ),
      })
    );
    const before = readDocxSemanticState(pkg);
    const command = {
      ...base('insert-third'),
      source: 'ai',
      operation: 'office.document.paragraph.insert',
      afterBlockId: before.body[1].id,
      expectedText: '第二段',
      text: '第三段😀',
    };
    const result = applyDocxCommand(pkg, command);
    expect(result.state.body.slice(0, 2)).toEqual(before.body);
    expect(result.state.body[2]).toMatchObject({
      type: 'paragraph',
      text: '第三段😀',
      editingSupported: true,
    });
    expect(result.state.stats.paragraphs).toBe(3);
    expect(result.state.body[2].id).not.toBe(before.body[0].id);
    expect(result.state.body[2].id).not.toBe(before.body[1].id);
    expect(
      openDocxPackage(result.packageBytes).readPart('custom/opaque.bin')
    ).toEqual(opaque);
    expect(applyDocxCommand(pkg, command).packageBytes).toEqual(
      result.packageBytes
    );
    expect(readDocxSemanticState(openDocxPackage(result.packageBytes))).toEqual(
      result.state
    );
  });

  test('inserting between legacy paragraphs assigns identities before positions change', () => {
    const pkg = openDocxPackage(
      minimalDocx({
        'word/document.xml': strToU8(
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>甲</w:t></w:r></w:p><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:body></w:document>`
        ),
      })
    );
    const before = readDocxSemanticState(pkg);
    const result = applyDocxCommand(pkg, {
      ...base('insert-middle'),
      source: 'ai',
      operation: 'office.document.paragraph.insert',
      afterBlockId: before.body[0].id,
      expectedText: '甲',
      text: '中间',
    });
    expect(
      result.state.body.map(block =>
        block.type === 'paragraph' ? block.text : null
      )
    ).toEqual(['甲', '中间', '乙']);
    expect(new Set(result.state.body.map(block => block.id)).size).toBe(3);
    expect(
      result.state.body.every(block =>
        /^paragraph:[0-7][0-9A-F]{7}$/.test(block.id)
      )
    ).toBe(true);
    expect(
      result.state.body.some(block =>
        before.body.some(old => old.id === block.id)
      )
    ).toBe(false);
  });

  test('paragraph insertion rejects stale, missing and nested anchors before writing', () => {
    const pkg = openDocxPackage(
      minimalDocx({
        'word/document.xml': strToU8(
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`
        ),
      })
    );
    const before = readDocxSemanticState(pkg);
    const command = {
      ...base('insert-denied'),
      source: 'ai',
      operation: 'office.document.paragraph.insert',
      afterBlockId: before.body[0].id,
      expectedText: '错误的旧正文',
      text: '新段落',
    };
    expect(() => applyDocxCommand(pkg, command)).toThrow(
      'does not match the expected source'
    );
    expect(() =>
      applyDocxCommand(pkg, { ...command, afterBlockId: 'missing' })
    ).toThrow('DOCX paragraph not found');
    const table = before.body[1];
    if (table.type !== 'table') throw new Error('Expected table');
    expect(() =>
      applyDocxCommand(pkg, {
        ...command,
        afterBlockId: table.rows[0].cells[0].blocks[0].id,
        expectedText: '表格',
      })
    ).toThrow('top-level body paragraph');
    expect(readDocxSemanticState(pkg)).toEqual(before);
  });

  test.each(['', 'OFFICE_RETRY_51：此文件仅用于本地测试。', '海棠😀。'])(
    'replaces a whole paragraph exactly using its ID and source text: %j',
    original => {
      const initial = openDocxPackage(
        minimalDocx({
          'word/document.xml': strToU8(`
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body>
                <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${original.slice(0, 2)}</w:t></w:r><w:r><w:t>${original.slice(2)}</w:t></w:r></w:p>
                <w:p><w:r><w:t>Unchanged paragraph.</w:t></w:r></w:p>
                <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
              </w:body>
            </w:document>`),
        })
      );
      const before = readDocxSemanticState(initial);
      const paragraph = before.body[0];
      expect(paragraph.type).toBe('paragraph');
      if (paragraph.type !== 'paragraph') return;
      const text = 'AI_UPDATE_110：指定段落更新成功😀。';
      const result = applyDocxCommand(initial, {
        ...base('paragraph-exact'),
        source: 'ai',
        operation: 'office.document.paragraph.text.set',
        target: { type: 'paragraph', blockId: paragraph.id },
        expectedText: original,
        text,
      });
      const after = result.state.body[0];
      expect(after.type).toBe('paragraph');
      if (after.type !== 'paragraph') return;
      expect(after.id).toBe(paragraph.id);
      expect(after.text).toBe(text);
      expect(after.properties).toEqual(paragraph.properties);
      expect(result.state.body[1]).toEqual(before.body[1]);
      expect(result.state.sections).toEqual(before.sections);
      expect(result.summary.operation).toBe(
        'office.document.paragraph.text.set'
      );
      expect(result.summary.deletedCharacters).toBe(original.length);
      expect(result.summary.expectedTextLength).toBe(original.length);
    }
  );

  test('whole paragraph replacement rejects a mismatched source and missing target without changing the package', () => {
    const initial = openDocxPackage(minimalDocx());
    const before = readDocxSemanticState(initial);
    const paragraph = before.body[0];
    if (paragraph.type !== 'paragraph') throw new Error('Missing paragraph');
    const command = {
      ...base('paragraph-mismatch'),
      operation: 'office.document.paragraph.text.set',
      target: { type: 'paragraph', blockId: paragraph.id },
      expectedText: 'Wrong source',
      text: 'Replacement',
    };
    expect(() => applyDocxCommand(initial, command)).toThrow(
      'does not match the expected source'
    );
    expect(() =>
      applyDocxCommand(initial, {
        ...command,
        target: { type: 'paragraph', blockId: 'missing' },
      })
    ).toThrow('target cannot be resolved');
    expect(() =>
      applyDocxCommand(initial, { ...command, expectedText: undefined })
    ).toThrow();
    expect(readDocxSemanticState(initial)).toEqual(before);
  });

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
    expect(sectioned.state.sections[0].endParagraphId).toBe(paragraph.id);
    expect(sectioned.state.sections[1]).toMatchObject({
      type: 'continuous',
      endParagraphId: null,
    });

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
    const insertedParagraph = result.state.body[0];
    if (
      fixture.object.type !== 'image' &&
      insertedParagraph.type === 'paragraph'
    ) {
      const object = insertedParagraph.runs
        .flatMap(run => run.content)
        .find(content => content.type === 'object');
      expect(object).toMatchObject({
        editableObject: true,
        objectData: fixture.object,
      });
      const changedObject =
        fixture.object.type === 'shape'
          ? { ...fixture.object, text: 'Changed object' }
          : fixture.object.type === 'equation'
            ? { ...fixture.object, linearText: 'a+b=c' }
            : { ...fixture.object, title: 'Changed chart' };
      const updated = applyDocxCommand(openDocxPackage(result.packageBytes), {
        ...base('object-update'),
        operation: 'office.document.object.update',
        target: { blockId: insertedParagraph.id, objectIndex: 0 },
        object: changedObject,
      });
      expect(updated.state.stats.objects).toBe(1);
      expect(updated.state.body[0]).toMatchObject({ text: 'Hello LocalMind' });
      const updatedParagraph = updated.state.body[0];
      if (updatedParagraph.type === 'paragraph')
        expect(
          updatedParagraph.runs
            .flatMap(run => run.content)
            .find(content => content.type === 'object')
        ).toMatchObject({ objectData: changedObject });
      expect(
        openDocxPackage(updated.packageBytes).readPart('custom/opaque.bin')
      ).toEqual(opaque);
      for (const invalid of [
        { source: 'ai' },
        { target: { blockId: insertedParagraph.id, objectIndex: 1 } },
        {
          object:
            fixture.object.type === 'shape'
              ? { type: 'equation', linearText: 'x' }
              : { type: 'shape', shape: 'line', widthPt: 20, heightPt: 20 },
        },
      ])
        expect(() =>
          applyDocxCommand(openDocxPackage(result.packageBytes), {
            ...base('invalid-update'),
            operation: 'office.document.object.update',
            target: { blockId: insertedParagraph.id, objectIndex: 0 },
            object: changedObject,
            ...invalid,
          })
        ).toThrow();
    }
    const reopened = openDocxPackage(result.packageBytes);
    expect(reopened.readPart('custom/opaque.bin')).toEqual(opaque);
    if (fixture.partPattern) {
      expect(
        reopened.listParts().some(part => fixture.partPattern?.test(part.path))
      ).toBe(true);
    }
  });

  test('preserves unsupported object formatting and refuses destructive updates', () => {
    const pkg = openDocxPackage(
      minimalDocx({
        'word/document.xml': strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:r><w:pict><v:rect style="width:100pt;height:50pt" stroked="f"><v:textbox><w:txbxContent><w:p><w:r><w:t>Preserve</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict><m:oMath><m:f><m:num><m:r><m:t>x</m:t></m:r></m:num><m:den><m:r><m:t>y</m:t></m:r></m:den></m:f></m:oMath></w:r></w:p></w:body></w:document>'
        ),
      })
    );
    const state = readDocxSemanticState(pkg),
      paragraph = state.body[0];
    if (paragraph.type !== 'paragraph') throw new Error('Missing paragraph');
    expect(
      paragraph.runs
        .flatMap(run => run.content)
        .filter(content => content.type === 'object')
        .map(content => content.editableObject)
    ).toEqual([false, false]);
    const before = pkg.requirePart(pkg.documentPart).slice();
    expect(() =>
      applyDocxCommand(pkg, {
        ...base('protected-object'),
        operation: 'office.document.object.update',
        target: { blockId: paragraph.id, objectIndex: 0 },
        object: {
          type: 'shape',
          shape: 'rectangle',
          widthPt: 100,
          heightPt: 50,
          text: 'Lost',
        },
      })
    ).toThrow('cannot be safely updated');
    expect(pkg.requirePart(pkg.documentPart)).toEqual(before);
  });

  test('exports supported shapes, linear equations and charts in body and table cells', async () => {
    let pkg = openDocxPackage(minimalDocx());
    const objects = [
      {
        type: 'shape',
        shape: 'ellipse',
        widthPt: 100,
        heightPt: 50,
        text: 'Shape preview',
      },
      { type: 'equation', linearText: 'a+b=c' },
      {
        type: 'chart',
        chartType: 'bar',
        title: 'Chart preview',
        widthPt: 200,
        heightPt: 120,
        categories: ['North', 'South'],
        series: [{ name: 'Sales', values: [-5, 12] }],
      },
    ];
    for (const object of objects) {
      const state = readDocxSemanticState(pkg),
        paragraph = state.body[0];
      if (paragraph.type !== 'paragraph') throw new Error('Missing paragraph');
      pkg = openDocxPackage(
        applyDocxCommand(pkg, {
          ...base(`preview-${object.type}`),
          operation: 'office.document.object.insert',
          target: { blockId: paragraph.id, offset: 0 },
          object,
        }).packageBytes
      );
    }
    for (const inTable of [false, true]) {
      const state = readDocxSemanticState(pkg);
      if (inTable)
        state.body = [
          {
            type: 'table',
            id: 'table',
            rows: [{ cells: [{ blocks: state.body }] }],
          },
        ];
      const bytes = await exportDocxStateToPdf(state);
      const pdf = await getDocument({
        data: bytes.slice(),
        useSystemFonts: true,
      }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        text += (await page.getTextContent()).items
          .map(item => ('str' in item ? item.str : ''))
          .join(' ');
      }
      expect(text).toContain('Shape preview');
      expect(text).toContain('a+b=c');
      expect(text).toContain('Chart preview');
      expect(text).not.toContain('[shape]');
      expect(text).not.toContain('[equation]');
      expect(text).not.toContain('[chart]');
      await pdf.destroy();
    }
  });

  test('object indices ignore math run properties and updates preserve other objects', () => {
    const pkg = openDocxPackage(
      minimalDocx({
        'word/document.xml': strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:r><w:rPr><w:oMath/></w:rPr><w:t>Before</w:t><m:oMath><m:r><m:t>first</m:t></m:r></m:oMath><m:oMath><m:r><m:t>second</m:t></m:r></m:oMath></w:r></w:p></w:body></w:document>'
        ),
      })
    );
    const state = readDocxSemanticState(pkg);
    const result = applyDocxCommand(pkg, {
      ...base('second-object'),
      operation: 'office.document.object.update',
      target: { blockId: state.body[0].id, objectIndex: 1 },
      object: { type: 'equation', linearText: 'changed' },
    });
    const paragraph = result.state.body[0];
    if (paragraph.type !== 'paragraph') throw new Error('Missing paragraph');
    expect(paragraph.text).toBe('Before');
    expect(
      paragraph.runs
        .flatMap(run => run.content)
        .filter(content => content.type === 'object')
        .map(content => content.objectData)
    ).toEqual([
      { type: 'equation', linearText: 'first' },
      { type: 'equation', linearText: 'changed' },
    ]);
    expect(
      new TextDecoder().decode(
        openDocxPackage(result.packageBytes).requirePart(pkg.documentPart)
      )
    ).toContain('<w:oMath/>');
  });

  test('cached external chart formulas are previewed but protected from replacement', () => {
    const pkg = openDocxPackage(minimalDocx()),
      state = readDocxSemanticState(pkg);
    const object = {
      type: 'chart',
      chartType: 'column',
      widthPt: 200,
      heightPt: 120,
      categories: ['A', 'B'],
      series: [{ name: 'Series', values: [1, 2] }],
    };
    const inserted = applyDocxCommand(pkg, {
      ...base('external-chart'),
      operation: 'office.document.object.insert',
      target: { blockId: state.body[0].id, offset: 0 },
      object,
    });
    const source = openDocxPackage(inserted.packageBytes);
    const part = source
      .listParts()
      .find(part => part.path.startsWith('word/charts/'))?.path;
    if (!part) throw new Error('Missing chart part');
    const xml = new TextDecoder()
      .decode(source.requirePart(part))
      .replace('<c:strRef>', '<c:strRef><c:f>Sheet1!A1</c:f>');
    const external = openDocxPackage(
      source.write(new Map([[part, strToU8(xml)]]))
    );
    const paragraph = readDocxSemanticState(external).body[0];
    if (paragraph.type !== 'paragraph') throw new Error('Missing paragraph');
    expect(
      paragraph.runs
        .flatMap(run => run.content)
        .find(content => content.type === 'object')
    ).toMatchObject({ editableObject: false, objectData: object });
    expect(() =>
      applyDocxCommand(external, {
        ...base('external-update'),
        operation: 'office.document.object.update',
        target: { blockId: paragraph.id, objectIndex: 0 },
        object,
      })
    ).toThrow('cannot be safely updated');
    expect(new TextDecoder().decode(external.requirePart(part))).toBe(xml);
  });

  test('inserts distinct VML identities and keeps them stable when updating shapes', () => {
    let pkg = openDocxPackage(minimalDocx());
    for (const shape of ['rectangle', 'ellipse', 'roundedRectangle']) {
      const state = readDocxSemanticState(pkg);
      pkg = openDocxPackage(
        applyDocxCommand(pkg, {
          ...base(shape),
          operation: 'office.document.object.insert',
          target: { blockId: state.body[0].id, offset: 0 },
          object: { type: 'shape', shape, widthPt: 100, heightPt: 60 },
        }).packageBytes
      );
    }
    const ids = (source: Uint8Array) =>
      [...new TextDecoder().decode(source).matchAll(/id="(_x0000_s\d+)"/g)].map(
        match => match[1]
      );
    const beforeIds = ids(pkg.requirePart(pkg.documentPart));
    expect(new Set(beforeIds).size).toBe(3);
    const state = readDocxSemanticState(pkg);
    const updated = openDocxPackage(
      applyDocxCommand(pkg, {
        ...base('stable-id'),
        operation: 'office.document.object.update',
        target: { blockId: state.body[0].id, objectIndex: 1 },
        object: { type: 'shape', shape: 'line', widthPt: 100, heightPt: 60 },
      }).packageBytes
    );
    expect(ids(updated.requirePart(updated.documentPart))).toEqual(beforeIds);
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

const unicodeFont = readFileSync(
  new URL(
    '../../assets/report-fonts/NotoSansCJKsc-Regular.otf',
    import.meta.url
  )
);
const emojiFont = readFileSync(
  new URL('../../assets/report-fonts/NotoEmoji-Variable.ttf', import.meta.url)
);
const pdfFixture = (body: string) =>
  readDocxSemanticState(
    openDocxPackage(
      minimalDocx({
        'word/document.xml': strToU8(
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
        ),
      })
    )
  );
const paragraphXml = (text: string) =>
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function pdfText(bytes: Uint8Array) {
  const document = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  }).promise;
  try {
    const pages = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.flatMap(item => ('str' in item ? [item] : [])));
    }
    return pages;
  } finally {
    await document.destroy();
  }
}

describe('DOCX PDF Unicode and layout regression', () => {
  test('splits PDF pages at the exact inline break, preserving the text on both sides', async () => {
    const state = pdfFixture(
      '<w:p><w:r><w:t>Before</w:t><w:br w:type="page"/><w:t>After</w:t></w:r></w:p>' +
        paragraphXml('Tail')
    );
    const pages = await pdfText(await exportDocxStateToPdf(state));
    expect(pages).toHaveLength(2);
    expect(pages[0].map(i => i.str).join('')).toContain('Before');
    expect(pages[0].map(i => i.str).join('')).not.toContain('After');
    expect(pages[1].map(i => i.str).join('')).toContain('AfterTail');
  });
  const tableFixture = (rows: string) =>
    pdfFixture(
      `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="3000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`
    );
  test('renders a real table grid with column widths, spans and separate cell text', async () => {
    const state = tableFixture(
      '<w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Merged</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>D</w:t></w:r></w:p></w:tc></w:tr>'
    );
    expect(state.body[0]).toMatchObject({
      widthType: 'dxa',
      columnWidthsTwips: [1000, 3000, 2000],
    });
    const items = (await pdfText(await exportDocxStateToPdf(state)))[0];
    for (const [text, x] of [
      ['A', 76],
      ['B', 126],
      ['C', 276],
      ['Merged', 76],
      ['D', 276],
    ] as const) {
      expect(items.find(item => item.str === text)?.transform[4]).toBeCloseTo(
        x
      );
    }
    expect(items.map(item => item.str).join('')).not.toContain('|');
    // Table top 720, padding 4, font ascent 11: one baseline subtraction.
    expect(items.find(item => item.str === 'A')?.transform[5]).toBeCloseTo(705);
    expect(
      items.find(item => item.str === 'Merged')?.transform[5]
    ).toBeLessThan(items.find(item => item.str === 'A')?.transform[5] ?? 0);
    expect(items.find(item => item.str === 'A')?.fontName).not.toBe(
      items.find(item => item.str === 'B')?.fontName
    );
  });
  test('continues a tall table row across pages without losing or duplicating cell paragraphs', async () => {
    const labels = Array.from(
      { length: 90 },
      (_, index) => `ROW_${String(index).padStart(3, '0')}_END`
    );
    const state = tableFixture(
      `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="3"/></w:tcPr>${labels.map(paragraphXml).join('')}</w:tc></w:tr>`
    );
    const pages = await pdfText(await exportDocxStateToPdf(state));
    expect(pages.length).toBeGreaterThan(1);
    const text = pages
      .flat()
      .map(item => item.str)
      .join('');
    for (const label of labels) expect(text.split(label)).toHaveLength(2);
    expect(
      pages
        .flat()
        .filter(item => item.str.startsWith('ROW_'))
        .every(item => item.transform[5] >= 72)
    ).toBe(true);
  });
  test('embeds supported images inside table cells and retains unsupported object markers', async () => {
    const state = tableFixture(
      '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="3"/></w:tcPr><w:p><w:r><w:t>Image cell</w:t></w:r></w:p></w:tc></w:tr>'
    );
    const table = state.body[0];
    if (table.type !== 'table') throw new Error('Expected table');
    const paragraph = table.rows[0].cells[0].blocks[0];
    if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph');
    paragraph.runs.push({
      content: [
        {
          type: 'object',
          objectType: 'image',
          part: 'word/media/test.png',
          contentType: 'image/png',
          widthPt: 32,
          heightPt: 24,
        },
        { type: 'object', objectType: 'equation' },
      ],
    });
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgaPgPQhAKACX2Bf2gcp/LAAAAAElFTkSuQmCC',
        'base64'
      )
    );
    const bytes = await exportDocxStateToPdf(state, { readPart: () => png });
    const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
    try {
      const operations = await (await pdf.getPage(1)).getOperatorList();
      expect(operations.fnArray).toContain(OPS.paintImageXObject);
    } finally {
      await pdf.destroy();
    }
    expect((await pdfText(bytes))[0].map(item => item.str).join('')).toContain(
      '[equation]'
    );
  });
  test('centers inline image and text together in source order on one baseline', async () => {
    const state = pdfFixture(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>BEFORE</w:t></w:r></w:p>'
    );
    const paragraph = state.body[0];
    if (paragraph.type !== 'paragraph') throw new Error('expected paragraph');
    paragraph.runs[0].content.push(
      {
        type: 'object',
        objectType: 'image',
        part: 'word/media/test.png',
        contentType: 'image/png',
        widthPt: 32,
        heightPt: 24,
      },
      { type: 'text', text: 'AFTER' }
    );
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgaPgPQhAKACX2Bf2gcp/LAAAAAElFTkSuQmCC',
        'base64'
      )
    );
    const bytes = await exportDocxStateToPdf(state, { readPart: () => png });
    const items = (await pdfText(bytes))[0];
    const before = items.find(i => i.str === 'BEFORE'),
      after = items.find(i => i.str === 'AFTER');
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after?.transform[4]).toBeCloseTo(
      (before?.transform[4] ?? 0) + (before?.width ?? 0) + 32
    );
    expect(after?.transform[5]).toBeCloseTo(before?.transform[5] ?? 0);
    expect(
      ((before?.transform[4] ?? 0) +
        (after?.transform[4] ?? 0) +
        (after?.width ?? 0)) /
        2
    ).toBeCloseTo(306);
    const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
    try {
      const ops = await (await pdf.getPage(1)).getOperatorList();
      const painted = ops.fnArray.indexOf(OPS.paintImageXObject);
      expect(painted).toBeGreaterThanOrEqual(0);
      let matrix = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      for (let index = 0; index < painted; index++) {
        if (ops.fnArray[index] === OPS.save) stack.push([...matrix]);
        else if (ops.fnArray[index] === OPS.restore)
          matrix = stack.pop() ?? matrix;
        else if (ops.fnArray[index] === OPS.transform) {
          const a = matrix,
            b = ops.argsArray[index] as number[];
          matrix = [
            a[0] * b[0] + a[2] * b[1],
            a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4],
            a[1] * b[4] + a[3] * b[5] + a[5],
          ];
        }
      }
      expect(matrix[4]).toBeCloseTo(
        (before?.transform[4] ?? 0) + (before?.width ?? 0)
      );
      expect(matrix[5] + 12).toBeCloseTo((before?.transform[5] ?? 0) + 2.75);
    } finally {
      await pdf.destroy();
    }
  });
  test('exports Chinese and astral emoji through a bundled fallback without changing text', async () => {
    const state = pdfFixture(paragraphXml('中文与😀整段替换正确。'));
    await expect(exportDocxStateToPdf(state, { unicodeFont })).rejects.toThrow(
      'cannot represent'
    );
    const bytes = await exportDocxStateToPdf(state, {
      unicodeFont,
      fallbackFonts: [emojiFont],
    });
    const text = (await pdfText(bytes))
      .flat()
      .map(item => item.str)
      .join('');
    expect(text).toContain('中文与😀整段替换正确。');
    expect(text).not.toContain('?');
  }, 20_000);

  test.each([
    ['nextPage', 2],
    ['continuous', 1],
    ['oddPage', 3],
    ['evenPage', 2],
  ])(
    'exports %s section boundaries without losing either paragraph',
    async (type, count) => {
      const state = pdfFixture(
        `<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:t>First</w:t></w:r></w:p>${paragraphXml('Second')}<w:sectPr><w:type w:val="${type}"/></w:sectPr>`
      );
      expect(state.sections[0].endParagraphId).toBe(state.body[0].id);
      expect(state.sections[1].endParagraphId).toBe(null);
      const output = await exportDocxStateToPdf(state);
      const pages = await pdfText(output);
      expect(pages).toHaveLength(count as number);
      expect(pages[0].map(item => item.str).join('')).toContain('First');
      expect(
        pages
          .at(-1)
          ?.map(item => item.str)
          .join('')
      ).toContain('Second');
      if (type === 'oddPage')
        expect(pages[1].map(item => item.str).join('')).not.toMatch(
          /First|Second/
        );
    }
  );
  test('exports differing section paper sizes and avoids an extra paragraph page break', async () => {
    const state = pdfFixture(
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr><w:r><w:t>Portrait</w:t></w:r></w:p><w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Landscape</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="16840" w:h="11900" w:orient="landscape"/></w:sectPr>'
    );
    const document = await PDFDocument.load(await exportDocxStateToPdf(state));
    expect(document.getPages().map(page => page.getSize())).toEqual([
      { width: 612, height: 792 },
      { width: 842, height: 595 },
    ]);
  });
  test('resolves section-specific and inherited stories without leaking a later section header', () => {
    const state = pdfFixture(`${paragraphXml('First')}<w:sectPr/>`);
    state.sections = [0, 1, 2].map(index => ({
      index,
      headerReferences: [],
      footerReferences: [],
    }));
    state.sections[1].headerReferences = [
      { type: 'default', part: 'word/header2.xml' },
    ];
    state.stories = [
      {
        kind: 'header',
        type: 'default',
        part: 'word/header2.xml',
        relationshipId: 'h2',
        blocks: [],
      },
    ];
    expect(docxSectionStory(state, 0, 'header')).toBeUndefined();
    expect(docxSectionStory(state, 1, 'header')).toBe(state.stories[0]);
    expect(docxSectionStory(state, 2, 'header')).toBe(state.stories[0]);
    state.sections[2].titlePage = true;
    expect(docxSectionStory(state, 2, 'header', true)).toBeUndefined();
  });
  test('preserves Chinese body, header and footer with embedded fonts', async () => {
    const state = pdfFixture(paragraphXml('正文中文，繁體字。'));
    state.stories = [
      {
        kind: 'header',
        part: 'word/header1.xml',
        blocks: pdfFixture(paragraphXml('页眉中文')).body,
      },
      {
        kind: 'footer',
        part: 'word/footer1.xml',
        blocks: pdfFixture(paragraphXml('页脚中文')).body,
      },
    ];
    state.sections = [
      {
        index: 0,
        endParagraphId: null,
        headerReferences: [{ part: 'word/header1.xml' }],
        footerReferences: [{ part: 'word/footer1.xml' }],
      },
    ];
    const bytes = await exportDocxStateToPdf(state, { unicodeFont });
    const text = (await pdfText(bytes))
      .flat()
      .map(item => item.str)
      .join('');
    expect(text).toContain('正文中文，繁體字。');
    expect(text).toContain('页眉中文');
    expect(text).toContain('页脚中文');
    expect(text).not.toContain('?');
    expect(new TextDecoder().decode(bytes)).toContain('/FontFile3');
  }, 20_000);

  test('retains mixed run fonts and centers the complete line', async () => {
    const state = pdfFixture(
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>plain</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t>italic</w:t></w:r><w:r><w:rPr><w:b/><w:i/><w:u w:val="single"/></w:rPr><w:t>中文</w:t></w:r></w:p>`
    );
    const lines = (
      await pdfText(await exportDocxStateToPdf(state, { unicodeFont }))
    )[0].filter(item => item.str !== '1' && item.str.trim());
    expect(lines.map(item => item.str).join('')).toBe('plainbolditalic中文');
    expect(
      new Set(lines.map(item => item.fontName)).size
    ).toBeGreaterThanOrEqual(4);
    const left = Math.min(...lines.map(item => item.transform[4]));
    const right = Math.max(
      ...lines.map(item => item.transform[4] + item.width)
    );
    // Italic glyph bounds can extend past the centered text advance.
    expect(Math.abs((left + right) / 2 - 306)).toBeLessThan(1);
    const chinese = lines.find(item => item.str === '中文');
    expect(chinese).toBeDefined();
    // Oblique glyphs must keep a horizontal baseline, including across scripts.
    expect(chinese?.transform[1]).toBe(0);
    expect(chinese?.transform[2]).toBeGreaterThan(0);
    expect(chinese?.transform[5]).toBeCloseTo(lines[0].transform[5]);
  }, 20_000);

  test('wraps long Chinese text across pages without dropping characters', async () => {
    const text = '甲乙丙丁'.repeat(100);
    const state = pdfFixture(paragraphXml(text));
    state.sections = [
      {
        index: 0,
        pageSize: { widthPt: 300, heightPt: 220 },
        margins: { leftPt: 36, rightPt: 36, topPt: 36, bottomPt: 36 },
        headerReferences: [],
        footerReferences: [],
      },
    ];
    const pages = await pdfText(
      await exportDocxStateToPdf(state, { unicodeFont })
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(
      pages
        .flat()
        .map(item => item.str)
        .join('')
        .replace(/[0-9\s]/g, '')
    ).toBe(text);
    expect(
      pages
        .flat()
        .filter(item => item.str.match(/[甲乙丙丁]/))
        .every(
          item =>
            item.transform[4] >= 36 && item.transform[4] + item.width <= 265
        )
    ).toBe(true);
  }, 20_000);

  test('preserves soft line breaks and excludes rejected tracked text', async () => {
    const state = pdfFixture(
      '<w:p><w:r><w:t>第一行</w:t><w:br/><w:t>第二行</w:t></w:r><w:del><w:r><w:delText>已删除</w:delText></w:r></w:del></w:p>'
    );
    const items = (
      await pdfText(await exportDocxStateToPdf(state, { unicodeFont }))
    )[0];
    expect(items.map(item => item.str).join('')).not.toContain('已删除');
    const first = items.find(item => item.str.includes('第一行'));
    const second = items.find(item => item.str.includes('第二行'));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.transform[5]).toBeGreaterThan(second!.transform[5]);
  }, 20_000);

  test('fails explicitly instead of silently replacing unsupported text', async () => {
    await expect(
      exportDocxStateToPdf(pdfFixture(paragraphXml('中文')))
    ).rejects.toThrow('cannot represent');
    await expect(
      exportDocxStateToPdf(pdfFixture(paragraphXml('\u{10ffff}')), {
        unicodeFont,
      })
    ).rejects.toThrow('cannot represent');
  }, 20_000);
});
