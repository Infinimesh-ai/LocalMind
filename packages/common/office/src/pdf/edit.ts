import {
  degrees,
  PDFCheckBox,
  PDFDict,
  type PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  rgb,
  StandardFonts,
} from 'pdf-lib';

import {
  type OfficePdfAddAnnotationCommand,
  type OfficePdfAddSignatureAppearanceCommand,
  type OfficePdfApplyRedactionCommand,
  type OfficePdfDeleteAnnotationCommand,
  type OfficePdfDeletePageCommand,
  type OfficePdfReorderPagesCommand,
  type OfficePdfRotatePageCommand,
  type OfficePdfSetFormFieldCommand,
  type OfficePdfUpdateAnnotationCommand,
  parseOfficeCommand,
} from '../command';
import { openPdfPackage, type PdfPackage, PdfPackageError } from './package';
import { type PdfSemanticState, readPdfSemanticState } from './semantic';

type PdfCommand =
  | OfficePdfAddAnnotationCommand
  | OfficePdfUpdateAnnotationCommand
  | OfficePdfDeleteAnnotationCommand
  | OfficePdfSetFormFieldCommand
  | OfficePdfRotatePageCommand
  | OfficePdfDeletePageCommand
  | OfficePdfReorderPagesCommand
  | OfficePdfAddSignatureAppearanceCommand
  | OfficePdfApplyRedactionCommand;

export type PdfCommandResult = {
  packageBytes: Uint8Array;
  state: PdfSemanticState;
  summary: Record<string, unknown>;
};

function assertPage(document: PDFDocument, pageIndex: number) {
  if (pageIndex < 0 || pageIndex >= document.getPageCount()) {
    throw new PdfPackageError(`PDF page index is out of range: ${pageIndex}`);
  }
  return document.getPage(pageIndex);
}

function rgbComponents(hex: string | undefined) {
  const value = (hex ?? '#FFF200').slice(1);
  return [0, 2, 4].map(
    index => Number.parseInt(value.slice(index, index + 2), 16) / 255
  );
}

function decodePdfString(value: PDFString | PDFHexString | undefined) {
  if (!value) return undefined;
  try {
    return value.decodeText();
  } catch {
    return undefined;
  }
}

function findAnnotation(document: PDFDocument, annotationId: string) {
  for (const [pageIndex, page] of document.getPages().entries()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (let index = 0; index < annotations.size(); index++) {
      const dictionary = annotations.lookupMaybe(index, PDFDict);
      if (!dictionary) continue;
      const id = decodePdfString(
        dictionary.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)
      );
      if (id === annotationId) {
        return { page, pageIndex, annotations, index, dictionary };
      }
    }
  }
  throw new PdfPackageError(`PDF annotation not found: ${annotationId}`);
}

function rectangleValues(rect: {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}) {
  return [
    rect.xPt,
    rect.yPt,
    rect.xPt + rect.widthPt,
    rect.yPt + rect.heightPt,
  ];
}

function assertRectangleOnPage(
  page: ReturnType<PDFDocument['getPage']>,
  rect: { xPt: number; yPt: number; widthPt: number; heightPt: number }
) {
  if (
    rect.xPt + rect.widthPt < 0 ||
    rect.yPt + rect.heightPt < 0 ||
    rect.xPt > page.getWidth() ||
    rect.yPt > page.getHeight()
  ) {
    throw new PdfPackageError('PDF rectangle is outside the page');
  }
}

function addAnnotation(
  document: PDFDocument,
  command: OfficePdfAddAnnotationCommand
) {
  const page = assertPage(document, command.target.pageIndex);
  const { xPt, yPt, widthPt, heightPt } = command.annotation.rect;
  assertRectangleOnPage(page, command.annotation.rect);
  const subtype = {
    text: 'Text',
    highlight: 'Highlight',
    underline: 'Underline',
    strikeout: 'StrikeOut',
    square: 'Square',
  }[command.annotation.subtype];
  const dictionary = document.context.obj({
    Type: 'Annot',
    Subtype: subtype,
    Rect: [xPt, yPt, xPt + widthPt, yPt + heightPt],
    Contents: PDFHexString.fromText(command.annotation.contents),
    NM: PDFHexString.fromText(command.commandId),
    C: rgbComponents(command.annotation.color),
    F: 4,
    ...(['Highlight', 'Underline', 'StrikeOut'].includes(subtype)
      ? {
          QuadPoints: [
            xPt,
            yPt + heightPt,
            xPt + widthPt,
            yPt + heightPt,
            xPt,
            yPt,
            xPt + widthPt,
            yPt,
          ],
        }
      : {}),
  }) as PDFDict;
  page.node.addAnnot(document.context.register(dictionary));
}

function updateAnnotation(
  document: PDFDocument,
  command: OfficePdfUpdateAnnotationCommand
) {
  const found = findAnnotation(document, command.annotationId);
  if (command.contents !== undefined) {
    found.dictionary.set(
      PDFName.of('Contents'),
      PDFHexString.fromText(command.contents)
    );
  }
  if (command.color !== undefined) {
    found.dictionary.set(
      PDFName.of('C'),
      document.context.obj(rgbComponents(command.color))
    );
  }
  if (command.rect !== undefined) {
    assertRectangleOnPage(found.page, command.rect);
    const values = rectangleValues(command.rect);
    found.dictionary.set(PDFName.of('Rect'), document.context.obj(values));
    const subtype = found.dictionary.lookupMaybe(
      PDFName.of('Subtype'),
      PDFName
    );
    if (subtype?.decodeText() === 'Highlight') {
      const { xPt, yPt, widthPt, heightPt } = command.rect;
      found.dictionary.set(
        PDFName.of('QuadPoints'),
        document.context.obj([
          xPt,
          yPt + heightPt,
          xPt + widthPt,
          yPt + heightPt,
          xPt,
          yPt,
          xPt + widthPt,
          yPt,
        ])
      );
    }
  }
  return found.pageIndex;
}

function deleteAnnotation(
  document: PDFDocument,
  command: OfficePdfDeleteAnnotationCommand
) {
  const found = findAnnotation(document, command.annotationId);
  found.annotations.remove(found.index);
  return found.pageIndex;
}

function decodeBase64(value: string, label: string) {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new PdfPackageError(`${label} is not valid base64`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function assertPng(bytes: Uint8Array, label: string) {
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    throw new PdfPackageError(`${label} is not a PNG image`);
  }
}

function asciiAppearanceText(value: string) {
  return [...value]
    .map(character => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126 ? character : '?';
    })
    .join('');
}

async function addSignatureAppearance(
  document: PDFDocument,
  command: OfficePdfAddSignatureAppearanceCommand
) {
  const page = assertPage(document, command.target.pageIndex);
  assertRectangleOnPage(page, command.rect);
  const { xPt, yPt, widthPt, heightPt } = command.rect;
  page.drawRectangle({
    x: xPt,
    y: yPt,
    width: widthPt,
    height: heightPt,
    borderColor: rgb(0.12, 0.29, 0.49),
    borderWidth: 1,
    color: rgb(0.96, 0.98, 1),
    opacity: 0.96,
  });
  if (command.imagePngBase64) {
    const imageBytes = decodeBase64(
      command.imagePngBase64,
      'PDF signature appearance image'
    );
    assertPng(imageBytes, 'PDF signature appearance image');
    const image = await document.embedPng(imageBytes);
    const scale = Math.min(widthPt / image.width, heightPt / image.height);
    page.drawImage(image, {
      x: xPt + (widthPt - image.width * scale) / 2,
      y: yPt + (heightPt - image.height * scale) / 2,
      width: image.width * scale,
      height: image.height * scale,
    });
  } else {
    const font = await document.embedFont(StandardFonts.Helvetica);
    const signer = asciiAppearanceText(command.signerName);
    page.drawText(signer, {
      x: xPt + 6,
      y: yPt + Math.max(18, heightPt - 18),
      size: Math.min(12, Math.max(7, heightPt / 4)),
      font,
      color: rgb(0.05, 0.16, 0.28),
      maxWidth: Math.max(1, widthPt - 12),
    });
    page.drawText('Appearance only - not a digital signature', {
      x: xPt + 6,
      y: yPt + 6,
      size: Math.min(7, Math.max(5, heightPt / 7)),
      font,
      color: rgb(0.3, 0.34, 0.4),
      maxWidth: Math.max(1, widthPt - 12),
    });
  }
  const dictionary = document.context.obj({
    Type: 'Annot',
    Subtype: 'Stamp',
    Name: 'SignHere',
    Rect: rectangleValues(command.rect),
    Contents: PDFHexString.fromText(
      [command.signerName, command.reason].filter(Boolean).join(' - ')
    ),
    T: PDFHexString.fromText(command.signerName),
    NM: PDFHexString.fromText(command.commandId),
    F: 4,
  }) as PDFDict;
  page.node.addAnnot(document.context.register(dictionary));
}

async function applyRedaction(
  document: PDFDocument,
  command: OfficePdfApplyRedactionCommand
) {
  const sourcePage = assertPage(document, command.target.pageIndex);
  const bytes = decodeBase64(
    command.flattenedPagePngBase64,
    'PDF flattened redaction page'
  );
  assertPng(bytes, 'PDF flattened redaction page');
  const image = await document.embedPng(bytes);
  const width = sourcePage.getWidth();
  const height = sourcePage.getHeight();
  const rotation = sourcePage.getRotation();
  const replacement = document.insertPage(command.target.pageIndex, [
    width,
    height,
  ]);
  replacement.setRotation(rotation);
  replacement.drawImage(image, { x: 0, y: 0, width, height });
  document.removePage(command.target.pageIndex + 1);
}

function setFormField(
  document: PDFDocument,
  command: OfficePdfSetFormFieldCommand
) {
  const field = document.getForm().getField(command.fieldName);
  if (field.isReadOnly())
    throw new PdfPackageError(
      `PDF form field is read-only: ${command.fieldName}`
    );
  if (field instanceof PDFTextField && typeof command.value === 'string') {
    field.setText(command.value);
  } else if (
    field instanceof PDFCheckBox &&
    typeof command.value === 'boolean'
  ) {
    if (command.value) field.check();
    else field.uncheck();
  } else if (
    (field instanceof PDFDropdown || field instanceof PDFOptionList) &&
    (typeof command.value === 'string' || Array.isArray(command.value))
  ) {
    field.select(command.value);
  } else if (
    field instanceof PDFRadioGroup &&
    typeof command.value === 'string'
  ) {
    field.select(command.value);
  } else {
    throw new PdfPackageError(
      `PDF form field value type does not match: ${command.fieldName}`
    );
  }
}

function reorderPages(document: PDFDocument, order: number[]) {
  const count = document.getPageCount();
  if (
    order.length !== count ||
    new Set(order).size !== count ||
    order.some(index => index < 0 || index >= count)
  ) {
    throw new PdfPackageError(
      'PDF page order must contain every page exactly once'
    );
  }
  const pages = document.getPages().slice();
  for (let index = count - 1; index >= 0; index--) document.removePage(index);
  order.forEach((sourceIndex, index) =>
    document.insertPage(index, pages[sourceIndex])
  );
}

async function apply(document: PDFDocument, command: PdfCommand) {
  switch (command.operation) {
    case 'office.pdf.annotation.add':
      addAnnotation(document, command);
      return {
        operation: command.operation,
        pageIndex: command.target.pageIndex,
        subtype: command.annotation.subtype,
        contentsLength: command.annotation.contents.length,
      };
    case 'office.pdf.annotation.update': {
      const pageIndex = updateAnnotation(document, command);
      return {
        operation: command.operation,
        annotationId: command.annotationId,
        pageIndex,
        contentsChanged: command.contents !== undefined,
        colorChanged: command.color !== undefined,
        rectangleChanged: command.rect !== undefined,
      };
    }
    case 'office.pdf.annotation.delete':
      return {
        operation: command.operation,
        annotationId: command.annotationId,
        pageIndex: deleteAnnotation(document, command),
      };
    case 'office.pdf.form.set':
      setFormField(document, command);
      return {
        operation: command.operation,
        fieldName: command.fieldName,
        valueType: Array.isArray(command.value)
          ? 'array'
          : typeof command.value,
        valueLength:
          typeof command.value === 'string'
            ? command.value.length
            : Array.isArray(command.value)
              ? command.value.length
              : 1,
      };
    case 'office.pdf.page.rotate':
      assertPage(document, command.target.pageIndex).setRotation(
        degrees(command.rotationDeg)
      );
      return {
        operation: command.operation,
        pageIndex: command.target.pageIndex,
        rotationDeg: command.rotationDeg,
      };
    case 'office.pdf.page.delete':
      if (document.getPageCount() === 1)
        throw new PdfPackageError('PDF cannot delete its final page');
      assertPage(document, command.target.pageIndex);
      document.removePage(command.target.pageIndex);
      return {
        operation: command.operation,
        pageIndex: command.target.pageIndex,
      };
    case 'office.pdf.pages.reorder':
      reorderPages(document, command.order);
      return { operation: command.operation, order: command.order };
    case 'office.pdf.signature.appearance.add':
      await addSignatureAppearance(document, command);
      return {
        operation: command.operation,
        pageIndex: command.target.pageIndex,
        signerNameLength: command.signerName.length,
        hasImage: Boolean(command.imagePngBase64),
        cryptographicSignature: false,
      };
    case 'office.pdf.redaction.apply':
      await applyRedaction(document, command);
      return {
        operation: command.operation,
        pageIndex: command.target.pageIndex,
        redactionCount: command.rects.length,
        flattened: true,
      };
  }
}

function verify(state: PdfSemanticState, command: PdfCommand) {
  switch (command.operation) {
    case 'office.pdf.annotation.add': {
      const annotation = state.pages[
        command.target.pageIndex
      ]?.annotations.find(item => item.id === command.commandId);
      if (!annotation || annotation.contents !== command.annotation.contents) {
        throw new PdfPackageError('PDF annotation output does not match');
      }
      break;
    }
    case 'office.pdf.annotation.update': {
      const annotation = state.pages
        .flatMap(page => page.annotations)
        .find(item => item.id === command.annotationId);
      if (!annotation) {
        throw new PdfPackageError('PDF updated annotation is missing');
      }
      if (
        command.contents !== undefined &&
        annotation.contents !== command.contents
      ) {
        throw new PdfPackageError('PDF annotation contents do not match');
      }
      if (command.color !== undefined && annotation.color !== command.color) {
        throw new PdfPackageError('PDF annotation color does not match');
      }
      break;
    }
    case 'office.pdf.annotation.delete':
      if (
        state.pages
          .flatMap(page => page.annotations)
          .some(item => item.id === command.annotationId)
      ) {
        throw new PdfPackageError('PDF annotation deletion did not persist');
      }
      break;
    case 'office.pdf.form.set': {
      const field = state.formFields.find(
        item => item.name === command.fieldName
      );
      const expected =
        field?.type === 'dropdown' || field?.type === 'optionList'
          ? Array.isArray(command.value)
            ? command.value
            : [command.value]
          : command.value;
      if (!field || JSON.stringify(field.value) !== JSON.stringify(expected)) {
        throw new PdfPackageError('PDF form output does not match');
      }
      break;
    }
    case 'office.pdf.page.rotate':
      if (
        state.pages[command.target.pageIndex]?.rotationDeg !==
        command.rotationDeg
      ) {
        throw new PdfPackageError('PDF rotation output does not match');
      }
      break;
    case 'office.pdf.page.delete':
      if (state.pages.length < 1)
        throw new PdfPackageError('PDF page deletion output is invalid');
      break;
    case 'office.pdf.pages.reorder':
      if (state.pages.length !== command.order.length)
        throw new PdfPackageError('PDF page reorder output is invalid');
      break;
    case 'office.pdf.signature.appearance.add':
      if (
        !state.pages[command.target.pageIndex]?.annotations.some(
          item => item.id === command.commandId && item.subtype === 'Stamp'
        )
      ) {
        throw new PdfPackageError('PDF signature appearance is missing');
      }
      break;
    case 'office.pdf.redaction.apply':
      if (!state.pages[command.target.pageIndex]) {
        throw new PdfPackageError('PDF redacted page is missing');
      }
      break;
  }
}

export async function applyPdfCommand(
  pkg: PdfPackage,
  input: unknown
): Promise<PdfCommandResult> {
  const parsed = parseOfficeCommand(input);
  if (!parsed.operation.startsWith('office.pdf.')) {
    throw new PdfPackageError(
      `Expected a PDF command, received ${parsed.operation}`
    );
  }
  const command = parsed as PdfCommand;
  const document = await pkg.cloneDocument();
  const summary = await apply(document, command);
  const packageBytes = await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: true,
  });
  if (packageBytes.byteLength > pkg.limits.maxPackageBytes) {
    throw new PdfPackageError('PDF command output exceeds its byte limit');
  }
  const outputPackage = await openPdfPackage(packageBytes, pkg.limits);
  const state = readPdfSemanticState(outputPackage);
  verify(state, command);
  return { packageBytes, state, summary };
}
