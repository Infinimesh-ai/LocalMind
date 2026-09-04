import { readFile } from 'node:fs/promises';

import {
  applyDocxCommand,
  openDocxPackage,
  readDocxSemanticState,
} from '@localmind/office/docx';
import test from 'ava';
import { strToU8, zipSync } from 'fflate';

const DOCUMENT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

function minimalDocx(
  options: {
    documentXml?: string;
    rootRelationshipsXml?: string;
    documentRelationshipsXml?: string;
    extras?: Record<string, Uint8Array>;
    omitDocument?: boolean;
  } = {}
) {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Default Extension="bin" ContentType="application/octet-stream"/>
        <Override PartName="/word/document.xml" ContentType="${DOCUMENT_CONTENT_TYPE}"/>
      </Types>`),
    '_rels/.rels': strToU8(
      options.rootRelationshipsXml ??
        `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
        </Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      options.documentRelationshipsXml ??
        `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
    ),
    ...options.extras,
  };
  if (!options.omitDocument) {
    files['word/document.xml'] = strToU8(
      options.documentXml ??
        `<?xml version="1.0" encoding="UTF-8"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>Hello LocalMind</w:t></w:r></w:p>
            <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
          </w:body>
        </w:document>`
    );
  }
  return zipSync(files, { level: 6 });
}

test('reads the real DOCX fixture into a bounded semantic model', async t => {
  const bytes = await readFile(
    new URL('../../../../../common/native/fixtures/demo.docx', import.meta.url)
  );
  const pkg = openDocxPackage(bytes);
  const state = readDocxSemanticState(pkg);

  t.is(pkg.documentPart, 'word/document.xml');
  t.true(state.stats.paragraphs > 0);
  t.true(state.stats.runs > 0);
  t.true(state.stats.styles > 0);
  t.true(state.stats.packageParts >= 30);
  t.true(
    state.body.some(
      block =>
        block.type === 'paragraph' &&
        block.text.includes('Demonstration of DOCX support')
    )
  );
  t.true(state.package.opaqueParts.includes('word/media/image1.gif'));
});

test('preserves unknown OPC parts byte-for-byte and inventories external relationships', t => {
  const opaqueBytes = new Uint8Array([0, 1, 2, 127, 255]);
  const bytes = minimalDocx({
    documentRelationshipsXml: `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="external1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a" TargetMode="External"/>
      </Relationships>`,
    extras: { 'custom/opaque.bin': opaqueBytes },
  });
  const pkg = openDocxPackage(bytes);
  const state = readDocxSemanticState(pkg);

  t.deepEqual(pkg.readPart('custom/opaque.bin'), opaqueBytes);
  t.true(state.package.opaqueParts.includes('custom/opaque.bin'));
  t.deepEqual(state.package.externalRelationships, [
    {
      sourcePart: 'word/document.xml',
      id: 'external1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      target: 'https://example.com/a',
    },
  ]);
});

test('reads document stories, references, review metadata, notes, protection, and objects', t => {
  const bytes = minimalDocx({
    documentXml: `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
        <w:body>
          <w:p>
            <w:bookmarkStart w:id="7" w:name="Overview"/>
            <w:fldSimple w:instr="TOC \\o &quot;1-3&quot;"><w:r><w:t>Contents</w:t></w:r></w:fldSimple>
            <w:ins w:id="9" w:author="Ada" w:date="2026-09-03T12:00:00Z"><w:r><w:t>Added</w:t></w:r></w:ins>
            <w:del w:id="10" w:author="Grace"><w:r><w:delText>Removed</w:delText></w:r></w:del>
            <w:r><w:drawing><wp:inline><wp:extent cx="127000" cy="254000"/><wp:docPr id="1" name="Diagram" descr="Architecture"/><a:graphic><a:graphicData><a:blip r:embed="image-rel"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>
            <w:bookmarkEnd w:id="7"/>
          </w:p>
          <w:sectPr>
            <w:headerReference w:type="default" r:id="header-rel"/>
            <w:footerReference w:type="default" r:id="footer-rel"/>
          </w:sectPr>
        </w:body>
      </w:document>`,
    documentRelationshipsXml: `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="header-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
        <Relationship Id="footer-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
        <Relationship Id="footnotes-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
        <Relationship Id="endnotes-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>
        <Relationship Id="comments-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
        <Relationship Id="settings-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
        <Relationship Id="image-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.bin"/>
      </Relationships>`,
    extras: {
      'word/header1.xml': strToU8(
        '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>'
      ),
      'word/footer1.xml': strToU8(
        '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer</w:t></w:r></w:p></w:ftr>'
      ),
      'word/footnotes.xml': strToU8(
        '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="2"><w:p><w:r><w:t>Footnote text</w:t></w:r></w:p></w:footnote></w:footnotes>'
      ),
      'word/endnotes.xml': strToU8(
        '<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:endnote w:id="3"><w:p><w:r><w:t>Endnote text</w:t></w:r></w:p></w:endnote></w:endnotes>'
      ),
      'word/comments.xml': strToU8(
        '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="4" w:author="Lin" w:initials="L"><w:p><w:r><w:t>Native comment</w:t></w:r></w:p></w:comment></w:comments>'
      ),
      'word/settings.xml': strToU8(
        '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/><w:documentProtection w:edit="comments" w:enforcement="1"/></w:settings>'
      ),
      'word/media/image.bin': new Uint8Array([1, 2, 3]),
    },
  });

  const state = readDocxSemanticState(openDocxPackage(bytes));

  t.deepEqual(
    state.stories.map(story => [story.kind, story.blocks[0]?.type]),
    [
      ['header', 'paragraph'],
      ['footer', 'paragraph'],
    ]
  );
  t.is(state.notes.footnotes[0]?.id, '2');
  t.is(state.notes.endnotes[0]?.id, '3');
  t.is(state.references.tableOfContentsFields[0]?.kind, 'TOC');
  t.is(state.references.bookmarks[0]?.name, 'Overview');
  t.true(state.review.trackRevisions);
  t.is(state.review.protection?.edit, 'comments');
  t.is(state.review.comments[0]?.text, 'Native comment');
  t.deepEqual(
    state.review.changes.map(change => [change.type, change.author]),
    [
      ['inserted', 'Ada'],
      ['deleted', 'Grace'],
    ]
  );
  const paragraph = state.body[0];
  t.is(paragraph?.type, 'paragraph');
  if (paragraph?.type !== 'paragraph') return;
  const object = paragraph.runs
    .flatMap(run => run.content)
    .find(content => content.type === 'object');
  t.deepEqual(object, {
    type: 'object',
    objectType: 'image',
    relationshipId: 'image-rel',
    part: 'word/media/image.bin',
    contentType: 'application/octet-stream',
    name: 'Diagram',
    description: 'Architecture',
    widthPt: 10,
    heightPt: 20,
  });
});

test('rejects ZIP traversal, unsafe limits, missing parts, and XML declarations', t => {
  t.throws(
    () =>
      openDocxPackage(
        minimalDocx({ extras: { '../outside.bin': new Uint8Array([1]) } })
      ),
    { message: /Invalid OPC part name/ }
  );
  t.throws(() => openDocxPackage(minimalDocx(), { maxEntries: 3 }), {
    message: /too many entries/,
  });
  t.throws(() => openDocxPackage(minimalDocx({ omitDocument: true })), {
    message: /missing its document part/,
  });
  const doctype = minimalDocx({
    documentXml: `<!DOCTYPE document [<!ENTITY x "unsafe">]>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body>
      </w:document>`,
  });
  t.throws(() => readDocxSemanticState(openDocxPackage(doctype)), {
    message: /declarations are not allowed/,
  });
});

test('rejects an internal relationship that escapes the package root', t => {
  const bytes = minimalDocx({
    rootRelationshipsXml: `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="../word/document.xml"/>
      </Relationships>`,
  });
  t.throws(() => openDocxPackage(bytes), {
    message: /escapes the package/,
  });
});

test('resolves relationships owned by a top-level package part', t => {
  const bytes = minimalDocx({
    extras: {
      'top.xml': strToU8('<root/>'),
      '_rels/top.xml.rels': strToU8(`
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="external-top" Type="urn:localmind:test" Target="https://example.com/top" TargetMode="External"/>
        </Relationships>`),
    },
  });
  const state = readDocxSemanticState(openDocxPackage(bytes));

  t.true(
    state.package.externalRelationships.some(
      relationship =>
        relationship.sourcePart === 'top.xml' &&
        relationship.id === 'external-top'
    )
  );
});

test('formats a stable text range and preserves unknown content deterministically', t => {
  const opaqueBytes = new Uint8Array([9, 8, 7, 6]);
  const bytes = minimalDocx({
    documentXml: `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <w:body>
          <w:p w14:paraId="A1B2C3D4">
            <w:r><w:t xml:space="preserve">Hello </w:t></w:r>
            <w:r><w:t>LocalMind</w:t></w:r>
          </w:p>
          <w:altChunk r:id="opaque-chunk"/>
          <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
        </w:body>
      </w:document>`,
    extras: { 'custom/opaque.bin': opaqueBytes },
  });
  const pkg = openDocxPackage(bytes);
  const command = {
    version: 'localmind-office-command/v1',
    commandId: 'format-command-1',
    idempotencyKey: 'format-command-1',
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'ai',
    operation: 'office.document.text.format',
    target: {
      type: 'text_range',
      start: { blockId: 'paragraph:A1B2C3D4', offset: 3 },
      end: { blockId: 'paragraph:A1B2C3D4', offset: 10 },
    },
    format: {
      fontFamily: 'Arial',
      fontSizePt: 14,
      textColor: '#0000ff',
      italic: true,
      underline: { style: 'single', color: '#ff0000' },
      paragraphStyleId: 'Heading2',
    },
  } as const;

  const first = applyDocxCommand(pkg, command);
  const second = applyDocxCommand(pkg, command);
  const formattedParagraph = first.state.body.find(
    block => block.type === 'paragraph'
  );

  t.deepEqual(first.packageBytes, second.packageBytes);
  t.is(formattedParagraph?.type, 'paragraph');
  if (formattedParagraph?.type !== 'paragraph') return;
  t.is(formattedParagraph.text, 'Hello LocalMind');
  t.is(formattedParagraph.properties?.styleId, 'Heading2');
  t.is(
    formattedParagraph.runs
      .filter(run => run.format?.italic)
      .flatMap(run => run.content)
      .filter(content => content.type === 'text')
      .map(content => content.text)
      .join(''),
    'lo Loca'
  );
  const selectedRun = formattedParagraph.runs.find(run => run.format?.italic);
  t.is(selectedRun?.format?.fontFamily, 'Arial');
  t.is(selectedRun?.format?.fontSizePt, 14);
  t.is(selectedRun?.format?.color, '#0000FF');
  t.deepEqual(selectedRun?.format?.underline, {
    style: 'single',
    color: '#FF0000',
  });
  const outputPackage = openDocxPackage(first.packageBytes);
  t.deepEqual(outputPackage.readPart('custom/opaque.bin'), opaqueBytes);
  t.regex(
    new TextDecoder().decode(outputPackage.requirePart('word/document.xml')),
    /<w:altChunk r:id="opaque-chunk"\s*\/>/
  );
  t.deepEqual(first.summary, {
    operation: 'office.document.text.format',
    changedParagraphs: 1,
    changedRuns: 2,
    splitRuns: 2,
  });
});

test('replaces text across runs and supports insertion at a stable offset', t => {
  const bytes = minimalDocx({
    documentXml: `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
        <w:body>
          <w:p w14:paraId="EDIT0001">
            <w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r>
            <w:r><w:rPr><w:i/></w:rPr><w:t>LocalMind</w:t></w:r>
          </w:p>
        </w:body>
      </w:document>`,
  });
  const replaced = applyDocxCommand(openDocxPackage(bytes), {
    version: 'localmind-office-command/v1',
    commandId: 'replace-command',
    idempotencyKey: 'replace-command',
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'user',
    operation: 'office.document.text.replace',
    target: {
      type: 'text_range',
      start: { blockId: 'paragraph:EDIT0001', offset: 3 },
      end: { blockId: 'paragraph:EDIT0001', offset: 10 },
    },
    text: 'p native L',
  });
  const paragraph = replaced.state.body[0];
  t.is(paragraph?.type, 'paragraph');
  if (paragraph?.type !== 'paragraph') return;
  t.is(paragraph.text, 'Help native LlMind');
  t.true(paragraph.runs.some(run => run.format?.bold));
  t.true(paragraph.runs.some(run => run.format?.italic));
  t.deepEqual(replaced.summary, {
    operation: 'office.document.text.replace',
    changedParagraphs: 1,
    changedRuns: 2,
    deletedCharacters: 7,
    insertedCharacters: 10,
  });

  const inserted = applyDocxCommand(openDocxPackage(replaced.packageBytes), {
    version: 'localmind-office-command/v1',
    commandId: 'insert-command',
    idempotencyKey: 'insert-command',
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-2',
    source: 'user',
    operation: 'office.document.text.replace',
    target: {
      type: 'text_range',
      start: { blockId: 'paragraph:EDIT0001', offset: 4 },
      end: { blockId: 'paragraph:EDIT0001', offset: 4 },
    },
    text: 'fully ',
  });
  const insertedParagraph = inserted.state.body[0];
  t.is(
    insertedParagraph?.type === 'paragraph' ? insertedParagraph.text : null,
    'Helpfully  native LlMind'
  );
});

test('edits paragraph layout, page geometry, breaks, and tables through structured commands', t => {
  const source = openDocxPackage(
    minimalDocx({
      documentXml: `
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
          <w:body>
            <w:p w14:paraId="LAYOUT01"><w:r><w:t>Layout target</w:t></w:r></w:p>
            <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
          </w:body>
        </w:document>`,
    })
  );
  const base = {
    version: 'localmind-office-command/v1',
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'user',
  } as const;
  const formatted = applyDocxCommand(source, {
    ...base,
    commandId: 'paragraph-format',
    idempotencyKey: 'paragraph-format',
    operation: 'office.document.paragraph.format',
    target: { type: 'paragraph', blockId: 'paragraph:LAYOUT01' },
    format: {
      alignment: 'center',
      spaceAfterPt: 12,
      lineSpacingPt: 18,
      leftIndentPt: 24,
      keepNext: true,
      outlineLevel: 1,
    },
  });
  const withBreak = applyDocxCommand(openDocxPackage(formatted.packageBytes), {
    ...base,
    commandId: 'page-break',
    idempotencyKey: 'page-break',
    operation: 'office.document.break.insert',
    target: { blockId: 'paragraph:LAYOUT01', offset: 6 },
    breakType: 'page',
  });
  const withTable = applyDocxCommand(openDocxPackage(withBreak.packageBytes), {
    ...base,
    commandId: 'insert-table',
    idempotencyKey: 'insert-table',
    operation: 'office.document.table.insert',
    afterBlockId: 'paragraph:LAYOUT01',
    rows: 2,
    columns: 2,
    cells: [
      ['Name', 'Value'],
      ['LocalMind', 'Office'],
    ],
  });
  const laidOut = applyDocxCommand(openDocxPackage(withTable.packageBytes), {
    ...base,
    commandId: 'page-layout',
    idempotencyKey: 'page-layout',
    operation: 'office.document.page.layout.set',
    sectionIndex: 0,
    layout: {
      widthPt: 842,
      heightPt: 595,
      orientation: 'landscape',
      marginLeftPt: 36,
      columns: 2,
      titlePage: true,
    },
  });

  const paragraph = laidOut.state.body[0];
  t.is(paragraph?.type, 'paragraph');
  if (paragraph?.type !== 'paragraph') return;
  t.is(paragraph.text, 'Layout\n target');
  t.like(paragraph.properties, {
    alignment: 'center',
    outlineLevel: 1,
    keepNext: true,
    spacing: { afterPt: 12, linePt: 18 },
    indent: { leftPt: 24 },
  });
  const table = laidOut.state.body[1];
  t.is(table?.type, 'table');
  if (table?.type !== 'table') return;
  t.is(table.rows[1]?.cells[0]?.blocks[0]?.type, 'paragraph');
  t.is(
    table.rows[1]?.cells[0]?.blocks[0]?.type === 'paragraph'
      ? table.rows[1].cells[0].blocks[0].text
      : null,
    'LocalMind'
  );
  t.like(laidOut.state.sections[0], {
    index: 0,
    pageSize: { widthPt: 842, heightPt: 595, orientation: 'landscape' },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 36 },
    titlePage: true,
    columns: 2,
    headerReferences: [],
    footerReferences: [],
  });
});

test('creates stories and inserts native images, shapes, equations, and charts', t => {
  const source = openDocxPackage(
    minimalDocx({
      documentXml: `
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
          <w:body>
            <w:p w14:paraId="OBJECT01"><w:r><w:t>Objects</w:t></w:r></w:p>
            <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
          </w:body>
        </w:document>`,
    })
  );
  const base = {
    version: 'localmind-office-command/v1',
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'user',
  } as const;
  const header = applyDocxCommand(source, {
    ...base,
    commandId: 'create-header',
    idempotencyKey: 'create-header',
    operation: 'office.document.header_footer.text.set',
    sectionIndex: 0,
    storyKind: 'header',
    storyType: 'default',
    text: 'LocalMind native header',
  });
  t.is(header.state.stories[0]?.kind, 'header');
  t.is(
    header.state.stories[0]?.blocks[0]?.type === 'paragraph'
      ? header.state.stories[0].blocks[0].text
      : null,
    'LocalMind native header'
  );
  t.is(header.summary.created, true);

  const image = applyDocxCommand(openDocxPackage(header.packageBytes), {
    ...base,
    commandId: 'insert-image',
    idempotencyKey: 'insert-image',
    operation: 'office.document.object.insert',
    target: { blockId: 'paragraph:OBJECT01', offset: 7 },
    object: {
      type: 'image',
      mimeType: 'image/png',
      dataBase64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2bQAAAABJRU5ErkJggg==',
      widthPt: 72,
      heightPt: 72,
      name: 'Pixel',
      description: 'One pixel image',
    },
  });
  const shape = applyDocxCommand(openDocxPackage(image.packageBytes), {
    ...base,
    commandId: 'insert-shape',
    idempotencyKey: 'insert-shape',
    operation: 'office.document.object.insert',
    target: { blockId: 'paragraph:OBJECT01', offset: 7 },
    object: {
      type: 'shape',
      shape: 'roundedRectangle',
      widthPt: 144,
      heightPt: 54,
      text: 'Native shape',
      fillColor: '#DDEEFF',
      lineColor: '#225588',
    },
  });
  const equation = applyDocxCommand(openDocxPackage(shape.packageBytes), {
    ...base,
    commandId: 'insert-equation',
    idempotencyKey: 'insert-equation',
    operation: 'office.document.object.insert',
    target: { blockId: 'paragraph:OBJECT01', offset: 7 },
    object: { type: 'equation', linearText: 'x^2 + y^2 = z^2' },
  });
  const chart = applyDocxCommand(openDocxPackage(equation.packageBytes), {
    ...base,
    commandId: 'insert-chart',
    idempotencyKey: 'insert-chart',
    operation: 'office.document.object.insert',
    target: { blockId: 'paragraph:OBJECT01', offset: 7 },
    object: {
      type: 'chart',
      chartType: 'column',
      title: 'Revenue',
      categories: ['Q1', 'Q2'],
      series: [{ name: '2026', values: [12, 18] }],
      widthPt: 360,
      heightPt: 216,
    },
  });
  const paragraph = chart.state.body[0];
  t.is(paragraph?.type, 'paragraph');
  if (paragraph?.type !== 'paragraph') return;
  t.deepEqual(
    paragraph.runs.flatMap(run =>
      run.content.flatMap(content =>
        content.type === 'object' ? [content.objectType] : []
      )
    ),
    ['image', 'shape', 'equation', 'chart']
  );
  const output = openDocxPackage(chart.packageBytes);
  t.true(output.hasPart('word/media/image1.png'));
  t.true(output.hasPart('word/charts/chart1.xml'));
  t.is(output.getContentType('word/media/image1.png'), 'image/png');
  t.is(
    output.getContentType('word/charts/chart1.xml'),
    'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
  );
});

test('edits stories and content controls, applies mail merge, and resolves tracked changes', t => {
  const bytes = minimalDocx({
    documentXml: `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <w:body>
          <w:sdt><w:sdtPr><w:id w:val="42"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Old control</w:t></w:r></w:p></w:sdtContent></w:sdt>
          <w:p><w:r><w:t>Hello {{Name}}</w:t></w:r></w:p>
          <w:p><w:fldSimple w:instr="MERGEFIELD Company"><w:r><w:t>Old company</w:t></w:r></w:fldSimple></w:p>
          <w:p><w:ins w:id="11" w:author="Ada"><w:r><w:t>Keep insertion</w:t></w:r></w:ins><w:del w:id="12" w:author="Grace"><w:r><w:delText>Remove deletion</w:delText></w:r></w:del></w:p>
          <w:sectPr><w:headerReference w:type="default" r:id="header-rel"/></w:sectPr>
        </w:body>
      </w:document>`,
    documentRelationshipsXml: `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="header-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
      </Relationships>`,
    extras: {
      'word/header1.xml': strToU8(
        '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Old header</w:t></w:r></w:p></w:hdr>'
      ),
    },
  });
  const base = {
    version: 'localmind-office-command/v1',
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'ai',
  } as const;
  const control = applyDocxCommand(openDocxPackage(bytes), {
    ...base,
    commandId: 'control',
    idempotencyKey: 'control',
    operation: 'office.document.content_control.text.set',
    contentControlId: 'content-control:42',
    text: 'Updated control',
  });
  const merge = applyDocxCommand(openDocxPackage(control.packageBytes), {
    ...base,
    commandId: 'merge',
    idempotencyKey: 'merge',
    operation: 'office.document.mail_merge.apply',
    values: { Name: 'Ada', Company: 'LocalMind' },
  });
  const review = applyDocxCommand(openDocxPackage(merge.packageBytes), {
    ...base,
    commandId: 'review',
    idempotencyKey: 'review',
    operation: 'office.document.review.resolve',
    action: 'accept',
  });
  const header = applyDocxCommand(openDocxPackage(review.packageBytes), {
    ...base,
    commandId: 'header',
    idempotencyKey: 'header',
    operation: 'office.document.header_footer.text.set',
    sectionIndex: 0,
    storyKind: 'header',
    storyType: 'default',
    text: 'LocalMind header',
  });

  const paragraphs = header.state.body.flatMap(block =>
    block.type === 'paragraph'
      ? [block]
      : block.type === 'contentControl'
        ? block.blocks.filter(child => child.type === 'paragraph')
        : []
  );
  t.true(paragraphs.some(paragraph => paragraph.text === 'Updated control'));
  t.true(paragraphs.some(paragraph => paragraph.text === 'Hello Ada'));
  t.true(paragraphs.some(paragraph => paragraph.text === 'LocalMind'));
  t.true(paragraphs.some(paragraph => paragraph.text === 'Keep insertion'));
  t.false(
    paragraphs.some(paragraph => paragraph.text.includes('Remove deletion'))
  );
  t.is(header.state.review.changes.length, 0);
  const headerParagraph = header.state.stories[0]?.blocks[0];
  t.is(
    headerParagraph?.type === 'paragraph' ? headerParagraph.text : null,
    'LocalMind header'
  );
});

test('rejects a text range that splits a Unicode surrogate pair', t => {
  const pkg = openDocxPackage(
    minimalDocx({
      documentXml: `
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
          <w:body>
            <w:p w14:paraId="UNICODE1"><w:r><w:t>A😀B</w:t></w:r></w:p>
          </w:body>
        </w:document>`,
    })
  );

  t.throws(
    () =>
      applyDocxCommand(pkg, {
        version: 'localmind-office-command/v1',
        commandId: 'unicode-command',
        idempotencyKey: 'unicode-command',
        artifactId: 'artifact-1',
        expectedRevisionId: 'revision-1',
        source: 'user',
        operation: 'office.document.text.format',
        target: {
          type: 'text_range',
          start: { blockId: 'paragraph:UNICODE1', offset: 2 },
          end: { blockId: 'paragraph:UNICODE1', offset: 3 },
        },
        format: { italic: true },
      }),
    { message: /splits a Unicode surrogate pair/ }
  );
});
