import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  type PDFField,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFString,
  PDFTextField,
} from 'pdf-lib';

import { type PdfPackage, PdfPackageError } from './package';

export const PDF_SEMANTIC_STATE_VERSION = 'localmind-office-pdf-state/v1';
export const PDF_MODEL_VERSION = 'localmind-office-pdf-model/v1';

export type PdfAnnotation = {
  id: string;
  subtype: string;
  rect?: { xPt: number; yPt: number; widthPt: number; heightPt: number };
  contents?: string;
  author?: string;
  color?: string;
};

export type PdfFormField = {
  name: string;
  type:
    | 'text'
    | 'checkbox'
    | 'dropdown'
    | 'optionList'
    | 'radio'
    | 'signature'
    | 'unknown';
  value: string | boolean | string[] | null;
  options?: string[];
  readOnly: boolean;
  required: boolean;
};

export type PdfSemanticState = {
  schemaVersion: typeof PDF_SEMANTIC_STATE_VERSION;
  modelVersion: typeof PDF_MODEL_VERSION;
  pdfVersion: string;
  byteSize: number;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    keywords: string[];
  };
  pages: Array<{
    id: string;
    index: number;
    widthPt: number;
    heightPt: number;
    rotationDeg: number;
    annotations: PdfAnnotation[];
  }>;
  formFields: PdfFormField[];
  compatibility: {
    signatures: number;
    unsupportedFormFields: string[];
  };
  stats: {
    pages: number;
    annotations: number;
    formFields: number;
  };
};

function decodeString(value: PDFString | PDFHexString | undefined) {
  if (!value) return undefined;
  try {
    return value.decodeText();
  } catch {
    return undefined;
  }
}

function annotationColor(dictionary: PDFDict) {
  const colors = dictionary.lookupMaybe(PDFName.of('C'), PDFArray);
  if (!colors || colors.size() < 3) return undefined;
  const values = [0, 1, 2].map(index =>
    colors.lookupMaybe(index, PDFNumber)?.asNumber()
  );
  if (values.some(value => value === undefined)) return undefined;
  return `#${values
    .map(value =>
      Math.round(Math.max(0, Math.min(1, value ?? 0)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`.toUpperCase();
}

function readAnnotations(pkg: PdfPackage, pageIndex: number) {
  const page = pkg.document.getPage(pageIndex);
  const annotations = page.node.Annots();
  const result: PdfAnnotation[] = [];
  if (!annotations) return result;
  for (let index = 0; index < annotations.size(); index++) {
    const dictionary = annotations.lookupMaybe(index, PDFDict);
    if (!dictionary) continue;
    const subtype =
      dictionary.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ??
      'Unknown';
    const rectangle = dictionary.lookupMaybe(PDFName.of('Rect'), PDFArray);
    const id =
      decodeString(
        dictionary.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)
      ) ?? `page:${pageIndex}:annotation:${index}`;
    result.push({
      id,
      subtype,
      rect: rectangle
        ? (() => {
            try {
              const rect = rectangle.asRectangle();
              return {
                xPt: rect.x,
                yPt: rect.y,
                widthPt: rect.width,
                heightPt: rect.height,
              };
            } catch {
              return undefined;
            }
          })()
        : undefined,
      contents: decodeString(
        dictionary.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)
      ),
      author: decodeString(
        dictionary.lookupMaybe(PDFName.of('T'), PDFString, PDFHexString)
      ),
      color: annotationColor(dictionary),
    });
  }
  return result;
}

function fieldState(field: PDFField): PdfFormField {
  let type: PdfFormField['type'] = 'unknown';
  let value: PdfFormField['value'] = null;
  let options: string[] | undefined;
  if (field instanceof PDFTextField) {
    type = 'text';
    value = field.getText() ?? '';
  } else if (field instanceof PDFCheckBox) {
    type = 'checkbox';
    value = field.isChecked();
  } else if (field instanceof PDFDropdown) {
    type = 'dropdown';
    value = field.getSelected();
    options = field.getOptions();
  } else if (field instanceof PDFOptionList) {
    type = 'optionList';
    value = field.getSelected();
    options = field.getOptions();
  } else if (field instanceof PDFRadioGroup) {
    type = 'radio';
    value = field.getSelected() ?? '';
    options = field.getOptions();
  } else if (field instanceof PDFSignature) {
    type = 'signature';
  }
  return {
    name: field.getName(),
    type,
    value,
    options,
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
  };
}

export function readPdfSemanticState(pkg: PdfPackage): PdfSemanticState {
  const pageCount = pkg.document.getPageCount();
  if (!pageCount || pageCount > pkg.limits.maxPages) {
    throw new PdfPackageError('PDF package has an invalid page count');
  }
  const pages = pkg.document.getPages().map((page, index) => {
    const size = page.getSize();
    return {
      id: `page:${index}`,
      index,
      widthPt: size.width,
      heightPt: size.height,
      rotationDeg: page.getRotation().angle,
      annotations: readAnnotations(pkg, index),
    };
  });
  let formFields: PdfFormField[] = [];
  try {
    formFields = pkg.document.getForm().getFields().map(fieldState);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PdfPackageError(`PDF form structure is invalid: ${message}`);
  }
  return {
    schemaVersion: PDF_SEMANTIC_STATE_VERSION,
    modelVersion: PDF_MODEL_VERSION,
    pdfVersion: pkg.version,
    byteSize: pkg.byteSize,
    metadata: {
      title: pkg.document.getTitle(),
      author: pkg.document.getAuthor(),
      subject: pkg.document.getSubject(),
      creator: pkg.document.getCreator(),
      producer: pkg.document.getProducer(),
      keywords:
        pkg.document
          .getKeywords()
          ?.split(/[,;]\s*/)
          .filter(Boolean) ?? [],
    },
    pages,
    formFields,
    compatibility: {
      signatures: formFields.filter(field => field.type === 'signature').length,
      unsupportedFormFields: formFields
        .filter(field => field.type === 'unknown')
        .map(field => field.name),
    },
    stats: {
      pages: pageCount,
      annotations: pages.reduce(
        (total, page) => total + page.annotations.length,
        0
      ),
      formFields: formFields.length,
    },
  };
}
