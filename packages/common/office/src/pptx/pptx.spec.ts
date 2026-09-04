import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { applyPptxCommand } from './edit';
import { openPptxPackage, PPTX_PRESENTATION_CONTENT_TYPE } from './package';
import { readPptxSemanticState } from './semantic';

function shapeTree(shape = '') {
  return `
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${shape}
    </p:spTree>`;
}

function minimalPptx(extras: Record<string, Uint8Array> = {}) {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(`
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Default Extension="bin" ContentType="application/octet-stream"/>
          <Override PartName="/ppt/presentation.xml" ContentType="${PPTX_PRESENTATION_CONTENT_TYPE}"/>
          <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
          <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
          <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
          <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
        </Types>`),
      '_rels/.rels': strToU8(`
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
        </Relationships>`),
      'ppt/presentation.xml': strToU8(`
        <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master-rel"/></p:sldMasterIdLst>
          <p:sldIdLst><p:sldId id="256" r:id="slide-rel"/></p:sldIdLst>
          <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
          <p:notesSz cx="6858000" cy="9144000"/>
        </p:presentation>`),
      'ppt/_rels/presentation.xml.rels': strToU8(`
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="master-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
          <Relationship Id="slide-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        </Relationships>`),
      'ppt/slides/slide1.xml': strToU8(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld name="Opening">${shapeTree(`
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Title 1" descr="Opening title"/><p:cNvSpPr/><p:nvPr><p:ph type="title" idx="0"/></p:nvPr></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
              <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2400" b="1"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Aptos Display"/></a:rPr><a:t>Hello LocalMind</a:t></a:r></a:p></p:txBody>
            </p:sp>
            <p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture 1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="image-rel"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic>
          `)}</p:cSld>
        </p:sld>`),
      'ppt/slides/_rels/slide1.xml.rels': strToU8(`
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="layout-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
          <Relationship Id="external-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
        </Relationships>`),
      'ppt/slideMasters/slideMaster1.xml': strToU8(`
        <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld>${shapeTree()}</p:cSld>
        </p:sldMaster>`),
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': strToU8(`
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="layout-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
          <Relationship Id="theme-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
        </Relationships>`),
      'ppt/slideLayouts/slideLayout1.xml': strToU8(`
        <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>${shapeTree()}</p:cSld></p:sldLayout>`),
      'ppt/theme/theme1.xml': strToU8(
        '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="LocalMind"/>'
      ),
      ...extras,
    },
    { level: 6 }
  );
}

function officeCommand(
  operation: string,
  input: Record<string, unknown>,
  id = operation
) {
  return {
    version: 'localmind-office-command/v1',
    commandId: id,
    idempotencyKey: id,
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'user',
    operation,
    ...input,
  };
}

function runCommand(bytes: Uint8Array, command: unknown) {
  return applyPptxCommand(openPptxPackage(bytes), command);
}

describe('native PPTX engine', () => {
  test('reads slide size, master graph, shape tree, text, and geometry', () => {
    const state = readPptxSemanticState(openPptxPackage(minimalPptx()));

    expect(state.slideSize).toEqual({
      widthPt: 960,
      heightPt: 540,
      type: 'screen16x9',
    });
    expect(state.slides).toHaveLength(1);
    expect(state.slides[0]).toMatchObject({
      id: 'slide-rel',
      part: 'ppt/slides/slide1.xml',
      layoutPart: 'ppt/slideLayouts/slideLayout1.xml',
    });
    expect(state.slides[0].shapes[0]).toMatchObject({
      id: '2',
      type: 'shape',
      name: 'Title 1',
      text: 'Hello LocalMind',
      placeholder: { type: 'title', index: 0 },
      geometry: {
        xPt: 72,
        yPt: 72,
        widthPt: 360,
        heightPt: 72,
        preset: 'rect',
      },
    });
    expect(state.slides[0].shapes[0].paragraphs?.[0].runs[0]).toMatchObject({
      fontFamily: 'Aptos Display',
      fontSizePt: 24,
      bold: true,
      color: '#112233',
    });
    expect(state.masters[0]).toMatchObject({
      part: 'ppt/slideMasters/slideMaster1.xml',
      themePart: 'ppt/theme/theme1.xml',
      layoutParts: ['ppt/slideLayouts/slideLayout1.xml'],
    });
    expect(state.package.externalRelationships).toEqual([
      {
        sourcePart: 'ppt/slides/slide1.xml',
        id: 'external-rel',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        target: 'https://example.com',
      },
    ]);
  });

  test('replaces shape text deterministically and preserves opaque parts', () => {
    const opaque = new Uint8Array([4, 2, 4, 2]);
    const pkg = openPptxPackage(minimalPptx({ 'custom/opaque.bin': opaque }));
    const command = {
      version: 'localmind-office-command/v1',
      commandId: 'shape-text',
      idempotencyKey: 'shape-text',
      artifactId: 'artifact-1',
      expectedRevisionId: 'revision-1',
      source: 'ai',
      operation: 'office.presentation.shape.text.set',
      target: { type: 'shape', slideId: 'slide-rel', shapeId: '2' },
      text: 'Native Slides\nSecond line',
    } as const;

    const first = applyPptxCommand(pkg, command);
    const second = applyPptxCommand(pkg, command);
    expect(first.packageBytes).toEqual(second.packageBytes);
    expect(first.state.slides[0].shapes[0].text).toBe(
      'Native Slides\nSecond line'
    );
    expect(
      first.state.slides[0].shapes[0].paragraphs?.[0].runs[0]
    ).toMatchObject({
      fontFamily: 'Aptos Display',
      fontSizePt: 24,
      bold: true,
    });
    expect(
      openPptxPackage(first.packageBytes).readPart('custom/opaque.bin')
    ).toEqual(opaque);
    expect(first.summary).toMatchObject({
      operation: 'office.presentation.shape.text.set',
      textLength: 25,
      paragraphs: 2,
    });
  });

  test('updates shape geometry and rejects missing stable targets', () => {
    const pkg = openPptxPackage(minimalPptx());
    const command = {
      version: 'localmind-office-command/v1',
      commandId: 'shape-geometry',
      idempotencyKey: 'shape-geometry',
      artifactId: 'artifact-1',
      expectedRevisionId: 'revision-1',
      source: 'user',
      operation: 'office.presentation.shape.geometry.set',
      target: { type: 'shape', slideId: 'slide-rel', shapeId: '2' },
      geometry: {
        xPt: 90,
        yPt: 100,
        widthPt: 400,
        heightPt: 80,
        rotationDeg: 12.5,
      },
    } as const;
    const result = applyPptxCommand(pkg, command);
    expect(result.state.slides[0].shapes[0].geometry).toMatchObject(
      command.geometry
    );
    expect(() =>
      applyPptxCommand(pkg, {
        ...command,
        target: { ...command.target, shapeId: 'missing' },
      })
    ).toThrow(/shape not found/);
  });

  test('adds and removes native shapes and image parts', () => {
    let result = runCommand(
      minimalPptx(),
      officeCommand('office.presentation.shape.add', {
        slideId: 'slide-rel',
        shape: 'roundedRectangle',
        geometry: {
          xPt: 100,
          yPt: 150,
          widthPt: 240,
          heightPt: 80,
          rotationDeg: 5,
        },
        text: 'Native shape',
        fillColor: '#FFF200',
        lineColor: '#112233',
      })
    );
    let bytes = result.packageBytes;
    const shape = result.state.slides[0].shapes.find(
      candidate => candidate.text === 'Native shape'
    );
    expect(shape).toMatchObject({
      type: 'shape',
      geometry: {
        xPt: 100,
        yPt: 150,
        widthPt: 240,
        heightPt: 80,
        rotationDeg: 5,
        preset: 'roundRect',
      },
    });

    result = runCommand(
      bytes,
      officeCommand('office.presentation.image.add', {
        slideId: 'slide-rel',
        mimeType: 'image/png',
        dataBase64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
        geometry: { xPt: 400, yPt: 120, widthPt: 120, heightPt: 120 },
        name: 'LocalMind image',
        description: 'Native image object',
      })
    );
    bytes = result.packageBytes;
    const image = result.state.slides[0].shapes.find(
      candidate => candidate.name === 'LocalMind image'
    );
    expect(image).toMatchObject({
      type: 'picture',
      description: 'Native image object',
      image: { contentType: 'image/png' },
    });
    expect(
      openPptxPackage(bytes).requirePart(image?.image?.part ?? '')[0]
    ).toBe(0x89);

    result = runCommand(
      bytes,
      officeCommand('office.presentation.shape.delete', {
        target: {
          type: 'shape',
          slideId: 'slide-rel',
          shapeId: image?.id,
        },
      })
    );
    bytes = result.packageBytes;
    expect(
      result.state.slides[0].shapes.some(item => item.id === image?.id)
    ).toBe(false);

    result = runCommand(
      bytes,
      officeCommand('office.presentation.shape.delete', {
        target: {
          type: 'shape',
          slideId: 'slide-rel',
          shapeId: shape?.id,
        },
      })
    );
    expect(
      result.state.slides[0].shapes.some(item => item.id === shape?.id)
    ).toBe(false);
  });

  test('manages slides, notes, duplication, ordering, and theme colors', () => {
    let result = runCommand(
      minimalPptx(),
      officeCommand('office.presentation.slide.add', {
        afterSlideId: 'slide-rel',
        title: 'Roadmap',
      })
    );
    let bytes = result.packageBytes;
    const added = result.state.slides.find(slide =>
      slide.shapes.some(shape => shape.text === 'Roadmap')
    );
    expect(added?.layoutPart).toBe('ppt/slideLayouts/slideLayout1.xml');

    result = runCommand(
      bytes,
      officeCommand('office.presentation.notes.text.set', {
        slideId: added?.id,
        text: 'Presenter note\nSecond line',
      })
    );
    bytes = result.packageBytes;
    expect(
      result.state.slides.find(slide => slide.id === added?.id)
    ).toMatchObject({ notesText: 'Presenter note\nSecond line' });

    result = runCommand(
      bytes,
      officeCommand('office.presentation.slide.duplicate', {
        slideId: added?.id,
      })
    );
    bytes = result.packageBytes;
    const copies = result.state.slides.filter(slide =>
      slide.shapes.some(shape => shape.text === 'Roadmap')
    );
    expect(copies).toHaveLength(2);
    const duplicate = copies.find(slide => slide.id !== added?.id);
    expect(duplicate?.notesText).toBe('Presenter note\nSecond line');

    result = runCommand(
      bytes,
      officeCommand('office.presentation.slides.reorder', {
        slideIds: [duplicate?.id, 'slide-rel', added?.id],
      })
    );
    bytes = result.packageBytes;
    expect(result.state.slides.map(slide => slide.id)).toEqual([
      duplicate?.id,
      'slide-rel',
      added?.id,
    ]);

    result = runCommand(
      bytes,
      officeCommand('office.presentation.theme.color.set', {
        masterId: '1',
        slot: 'accent1',
        color: '#0057B8',
      })
    );
    bytes = result.packageBytes;
    expect(result.state.masters[0].themeColors.accent1).toBe('#0057B8');

    result = runCommand(
      bytes,
      officeCommand('office.presentation.slide.delete', {
        slideId: added?.id,
      })
    );
    bytes = result.packageBytes;
    expect(result.state.slides.some(slide => slide.id === added?.id)).toBe(
      false
    );

    result = runCommand(
      bytes,
      officeCommand('office.presentation.slide.delete', {
        slideId: duplicate?.id,
      })
    );
    expect(result.state.slides.map(slide => slide.id)).toEqual(['slide-rel']);
  });
});
