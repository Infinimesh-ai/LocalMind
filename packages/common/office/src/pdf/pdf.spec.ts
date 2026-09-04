import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, test } from 'vitest';

import { applyPdfCommand } from './edit';
import { openPdfPackage } from './package';
import { readPdfSemanticState } from './semantic';

async function minimalPdf() {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.setTitle('LocalMind Native PDF');
  document.setAuthor('LocalMind');
  const first = document.addPage([612, 792]);
  const second = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  first.drawText('Page one', { x: 72, y: 720, font, size: 12 });
  second.drawText('Page two', { x: 40, y: 240, font, size: 12 });
  const form = document.getForm();
  const name = form.createTextField('person.name');
  name.setText('Ada');
  name.addToPage(first, { x: 72, y: 650, width: 180, height: 24, font });
  const approved = form.createCheckBox('approved');
  approved.addToPage(first, { x: 72, y: 610, width: 18, height: 18 });
  const department = form.createDropdown('department');
  department.addOptions(['Engineering', 'Design']);
  department.select('Engineering');
  department.addToPage(first, { x: 72, y: 560, width: 180, height: 24, font });
  return await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: true,
  });
}

function commandBase(operation: string) {
  return {
    version: 'localmind-office-command/v1',
    commandId: `${operation}-command`,
    idempotencyKey: `${operation}-command`,
    artifactId: 'artifact-1',
    expectedRevisionId: 'revision-1',
    source: 'user',
    operation,
  } as const;
}

describe('native PDF engine', () => {
  test('validates PDF bytes and reads pages, metadata, annotations, and forms', async () => {
    const pkg = await openPdfPackage(await minimalPdf());
    const state = readPdfSemanticState(pkg);

    expect(state.metadata).toMatchObject({
      title: 'LocalMind Native PDF',
      author: 'LocalMind',
    });
    expect(state.pages.map(page => [page.widthPt, page.heightPt])).toEqual([
      [612, 792],
      [400, 300],
    ]);
    expect(state.formFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'person.name',
          type: 'text',
          value: 'Ada',
        }),
        expect.objectContaining({
          name: 'approved',
          type: 'checkbox',
          value: false,
        }),
        expect.objectContaining({
          name: 'department',
          type: 'dropdown',
          value: ['Engineering'],
          options: ['Engineering', 'Design'],
        }),
      ])
    );
    await expect(
      openPdfPackage(new TextEncoder().encode('not a pdf'))
    ).rejects.toThrow(/valid header/);
    const withoutEof = pkg.readBytes().slice(0, -10);
    await expect(openPdfPackage(withoutEof)).rejects.toThrow(/EOF marker/);
  });

  test('adds a real annotation deterministically and reopens it', async () => {
    const pkg = await openPdfPackage(await minimalPdf());
    const command = {
      ...commandBase('office.pdf.annotation.add'),
      operation: 'office.pdf.annotation.add',
      target: { type: 'page', pageIndex: 0 },
      annotation: {
        subtype: 'highlight',
        rect: { xPt: 70, yPt: 715, widthPt: 80, heightPt: 16 },
        contents: 'Review this sentence',
        color: '#FFFF00',
      },
    } as const;
    const first = await applyPdfCommand(pkg, command);
    const second = await applyPdfCommand(pkg, command);

    expect(first.packageBytes).toEqual(second.packageBytes);
    expect(first.state.pages[0].annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'office.pdf.annotation.add-command',
          subtype: 'Highlight',
          contents: 'Review this sentence',
          color: '#FFFF00',
        }),
      ])
    );
  });

  test.each([
    ['underline', 'Underline'],
    ['strikeout', 'StrikeOut'],
  ] as const)('adds a %s text markup annotation', async (subtype, expected) => {
    const pkg = await openPdfPackage(await minimalPdf());
    const commandId = `office.pdf.annotation.${subtype}`;
    const result = await applyPdfCommand(pkg, {
      ...commandBase('office.pdf.annotation.add'),
      commandId,
      idempotencyKey: commandId,
      operation: 'office.pdf.annotation.add',
      target: { type: 'page', pageIndex: 0 },
      annotation: {
        subtype,
        rect: { xPt: 70, yPt: 690, widthPt: 120, heightPt: 16 },
        contents: `${expected} review mark`,
        color: '#0057B8',
      },
    });

    expect(result.state.pages[0].annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: commandId,
          subtype: expected,
          contents: `${expected} review mark`,
          color: '#0057B8',
        }),
      ])
    );
  });

  test('sets form values and verifies type compatibility', async () => {
    const pkg = await openPdfPackage(await minimalPdf());
    const text = await applyPdfCommand(pkg, {
      ...commandBase('office.pdf.form.set'),
      operation: 'office.pdf.form.set',
      fieldName: 'person.name',
      value: 'Grace',
    });
    expect(
      text.state.formFields.find(field => field.name === 'person.name')?.value
    ).toBe('Grace');
    const checked = await applyPdfCommand(pkg, {
      ...commandBase('office.pdf.form.set'),
      commandId: 'check-command',
      idempotencyKey: 'check-command',
      operation: 'office.pdf.form.set',
      fieldName: 'approved',
      value: true,
    });
    expect(
      checked.state.formFields.find(field => field.name === 'approved')?.value
    ).toBe(true);
    await expect(
      applyPdfCommand(pkg, {
        ...commandBase('office.pdf.form.set'),
        operation: 'office.pdf.form.set',
        fieldName: 'approved',
        value: 'yes',
      })
    ).rejects.toThrow(/value type does not match/);
  });

  test('rotates, deletes, and reorders pages without reflow', async () => {
    const pkg = await openPdfPackage(await minimalPdf());
    const rotated = await applyPdfCommand(pkg, {
      ...commandBase('office.pdf.page.rotate'),
      operation: 'office.pdf.page.rotate',
      target: { type: 'page', pageIndex: 1 },
      rotationDeg: 90,
    });
    expect(rotated.state.pages[1].rotationDeg).toBe(90);

    const reordered = await applyPdfCommand(pkg, {
      ...commandBase('office.pdf.pages.reorder'),
      operation: 'office.pdf.pages.reorder',
      order: [1, 0],
    });
    expect(reordered.state.pages.map(page => page.widthPt)).toEqual([400, 612]);

    const deleted = await applyPdfCommand(pkg, {
      ...commandBase('office.pdf.page.delete'),
      operation: 'office.pdf.page.delete',
      target: { type: 'page', pageIndex: 0 },
    });
    expect(deleted.state.pages).toHaveLength(1);
    const single = await openPdfPackage(deleted.packageBytes);
    await expect(
      applyPdfCommand(single, {
        ...commandBase('office.pdf.page.delete'),
        operation: 'office.pdf.page.delete',
        target: { type: 'page', pageIndex: 0 },
      })
    ).rejects.toThrow(/final page/);
  });

  test('updates and deletes annotations by stable annotation id', async () => {
    const pkg = await openPdfPackage(await minimalPdf());
    const added = await applyPdfCommand(pkg, {
      ...commandBase('office.pdf.annotation.add'),
      operation: 'office.pdf.annotation.add',
      target: { type: 'page', pageIndex: 0 },
      annotation: {
        subtype: 'highlight',
        rect: { xPt: 70, yPt: 715, widthPt: 80, heightPt: 16 },
        contents: 'Initial review',
        color: '#FFFF00',
      },
    });
    const updated = await applyPdfCommand(
      await openPdfPackage(added.packageBytes),
      {
        ...commandBase('office.pdf.annotation.update'),
        operation: 'office.pdf.annotation.update',
        annotationId: 'office.pdf.annotation.add-command',
        contents: 'Resolved wording',
        color: '#00AAFF',
        rect: { xPt: 68, yPt: 712, widthPt: 120, heightPt: 20 },
      }
    );
    expect(
      updated.state.pages[0].annotations.find(
        annotation => annotation.id === 'office.pdf.annotation.add-command'
      )
    ).toMatchObject({
      id: 'office.pdf.annotation.add-command',
      contents: 'Resolved wording',
      color: '#00AAFF',
      rect: { xPt: 68, yPt: 712, widthPt: 120, heightPt: 20 },
    });
    const deleted = await applyPdfCommand(
      await openPdfPackage(updated.packageBytes),
      {
        ...commandBase('office.pdf.annotation.delete'),
        operation: 'office.pdf.annotation.delete',
        annotationId: 'office.pdf.annotation.add-command',
      }
    );
    expect(
      deleted.state.pages[0].annotations.some(
        annotation => annotation.id === 'office.pdf.annotation.add-command'
      )
    ).toBe(false);
  });

  test('adds an explicit non-cryptographic signature appearance', async () => {
    const result = await applyPdfCommand(
      await openPdfPackage(await minimalPdf()),
      {
        ...commandBase('office.pdf.signature.appearance.add'),
        operation: 'office.pdf.signature.appearance.add',
        target: { type: 'page', pageIndex: 0 },
        rect: { xPt: 320, yPt: 80, widthPt: 220, heightPt: 60 },
        signerName: 'Ada Lovelace',
        reason: 'Reviewed',
      }
    );
    expect(result.state.pages[0].annotations).toContainEqual(
      expect.objectContaining({
        id: 'office.pdf.signature.appearance.add-command',
        subtype: 'Stamp',
        author: 'Ada Lovelace',
      })
    );
    expect(result.summary).toMatchObject({
      cryptographicSignature: false,
      hasImage: false,
    });
  });

  test('applies redaction by replacing the original page with a flattened image', async () => {
    const result = await applyPdfCommand(
      await openPdfPackage(await minimalPdf()),
      {
        ...commandBase('office.pdf.redaction.apply'),
        operation: 'office.pdf.redaction.apply',
        target: { type: 'page', pageIndex: 0 },
        flattenedPagePngBase64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
        rects: [{ xPt: 65, yPt: 710, widthPt: 100, heightPt: 24 }],
      }
    );
    expect(result.state.pages).toHaveLength(2);
    expect(result.state.pages[0]).toMatchObject({
      widthPt: 612,
      heightPt: 792,
      annotations: [],
    });
    expect(result.state.pages[1]).toMatchObject({
      widthPt: 400,
      heightPt: 300,
    });
    expect(result.summary).toMatchObject({
      redactionCount: 1,
      flattened: true,
    });
  });
});
