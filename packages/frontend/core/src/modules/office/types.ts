import type {
  OfficeDocumentContentControlTextCommand,
  OfficeDocumentFormatParagraphCommand,
  OfficeDocumentFormatTextCommand,
  OfficeDocumentHeaderFooterTextCommand,
  OfficeDocumentInsertBreakCommand,
  OfficeDocumentInsertObjectCommand,
  OfficeDocumentInsertSectionCommand,
  OfficeDocumentInsertTableCommand,
  OfficeDocumentMailMergeCommand,
  OfficeDocumentPageLayoutCommand,
  OfficeDocumentReplaceTextCommand,
  OfficeDocumentReviewResolveCommand,
} from '@localmind/office';
import type {
  DocxBlock,
  DocxParagraph,
  DocxRunContent,
  DocxSemanticState,
} from '@localmind/office/docx';
import type { PdfSemanticState } from '@localmind/office/pdf';
import type { PptxSemanticState } from '@localmind/office/pptx';
import type { XlsxSemanticState } from '@localmind/office/xlsx';

export type {
  OfficeCommand,
  OfficeDocumentContentControlTextCommand,
  OfficeDocumentFormatParagraphCommand,
  OfficeDocumentFormatTextCommand,
  OfficeDocumentHeaderFooterTextCommand,
  OfficeDocumentInsertBreakCommand,
  OfficeDocumentInsertObjectCommand,
  OfficeDocumentInsertSectionCommand,
  OfficeDocumentInsertTableCommand,
  OfficeDocumentMailMergeCommand,
  OfficeDocumentPageLayoutCommand,
  OfficeDocumentReplaceTextCommand,
  OfficeDocumentReviewResolveCommand,
  OfficePdfAddAnnotationCommand,
  OfficePdfAddSignatureAppearanceCommand,
  OfficePdfApplyRedactionCommand,
  OfficePdfDeleteAnnotationCommand,
  OfficePdfDeletePageCommand,
  OfficePdfReorderPagesCommand,
  OfficePdfRotatePageCommand,
  OfficePdfSetFormFieldCommand,
  OfficePdfUpdateAnnotationCommand,
  OfficePresentationAddImageCommand,
  OfficePresentationAddShapeCommand,
  OfficePresentationAddSlideCommand,
  OfficePresentationDeleteShapeCommand,
  OfficePresentationDeleteSlideCommand,
  OfficePresentationDuplicateSlideCommand,
  OfficePresentationReorderSlidesCommand,
  OfficePresentationSetNotesCommand,
  OfficePresentationSetShapeGeometryCommand,
  OfficePresentationSetShapeTextCommand,
  OfficePresentationSetThemeColorCommand,
  OfficeWorkbookAddChartCommand,
  OfficeWorkbookColumnPropertiesCommand,
  OfficeWorkbookDeleteChartCommand,
  OfficeWorkbookDimensionChangeCommand,
  OfficeWorkbookFilterCommand,
  OfficeWorkbookFormatRangeCommand,
  OfficeWorkbookMergeCellsCommand,
  OfficeWorkbookRowPropertiesCommand,
  OfficeWorkbookSetCellCommand,
  OfficeWorkbookSetTableCommand,
  OfficeWorkbookSheetAddCommand,
  OfficeWorkbookSheetDeleteCommand,
  OfficeWorkbookSheetRenameCommand,
  OfficeWorkbookSheetReorderCommand,
  OfficeWorkbookValidationCommand,
} from '@localmind/office';
export type {
  DocxBlock,
  DocxParagraph,
  DocxRun,
  DocxRunContent,
  DocxRunFormat,
  DocxSection,
  DocxSemanticState,
  DocxStory,
  DocxStyle,
  DocxTable,
} from '@localmind/office/docx';
export type {
  PdfAnnotation,
  PdfFormField,
  PdfSemanticState,
} from '@localmind/office/pdf';
export type {
  PptxGeometry,
  PptxSemanticState,
  PptxShape,
  PptxSlide,
} from '@localmind/office/pptx';
export type {
  XlsxCell,
  XlsxCellStyle,
  XlsxSemanticState,
  XlsxWorksheet,
} from '@localmind/office/xlsx';

export type OfficeArtifactKindValue =
  | 'document'
  | 'workbook'
  | 'presentation'
  | 'pdf';

export type NativeOfficeState =
  | DocxSemanticState
  | XlsxSemanticState
  | PptxSemanticState
  | PdfSemanticState;

export type OfficeTextPosition = {
  blockId: string;
  offset: number;
};

export type OfficeTextRange = {
  type: 'text_range';
  start: OfficeTextPosition;
  end: OfficeTextPosition;
};

export type OfficeCommentAnchor =
  | {
      kind: 'document';
      revisionId: string;
      start: OfficeTextPosition;
      end: OfficeTextPosition;
    }
  | {
      kind: 'workbook';
      revisionId: string;
      sheetId: string;
      address: string;
    }
  | {
      kind: 'presentation';
      revisionId: string;
      slideId: string;
      shapeId?: string;
    }
  | {
      kind: 'pdf';
      revisionId: string;
      pageIndex: number;
      rect?: {
        xPt: number;
        yPt: number;
        widthPt: number;
        heightPt: number;
      };
    };

export type OfficeCommentContent = {
  version: 'localmind-office-comment/v1';
  text: string;
  anchor: OfficeCommentAnchor;
};

export type OfficeCommentReplyContent = {
  version: 'localmind-office-comment-reply/v1';
  text: string;
};

export type OfficeDocumentFormat = OfficeDocumentFormatTextCommand['format'];

export type OfficeDocxCommand =
  | OfficeDocumentFormatTextCommand
  | OfficeDocumentReplaceTextCommand
  | OfficeDocumentFormatParagraphCommand
  | OfficeDocumentInsertBreakCommand
  | OfficeDocumentInsertSectionCommand
  | OfficeDocumentInsertObjectCommand
  | OfficeDocumentInsertTableCommand
  | OfficeDocumentPageLayoutCommand
  | OfficeDocumentHeaderFooterTextCommand
  | OfficeDocumentContentControlTextCommand
  | OfficeDocumentReviewResolveCommand
  | OfficeDocumentMailMergeCommand;

export type OfficeDocxPage = {
  index: number;
  blocks: DocxBlock[];
  widthPt: number;
  heightPt: number;
  margins: {
    topPt: number;
    rightPt: number;
    bottomPt: number;
    leftPt: number;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isOfficeCommentContent(
  value: unknown
): value is OfficeCommentContent {
  return (
    isRecord(value) &&
    value.version === 'localmind-office-comment/v1' &&
    typeof value.text === 'string' &&
    isRecord(value.anchor) &&
    ['document', 'workbook', 'presentation', 'pdf'].includes(
      String(value.anchor.kind)
    ) &&
    typeof value.anchor.revisionId === 'string'
  );
}

export function isOfficeCommentReplyContent(
  value: unknown
): value is OfficeCommentReplyContent {
  return (
    isRecord(value) &&
    value.version === 'localmind-office-comment-reply/v1' &&
    typeof value.text === 'string'
  );
}

export function isDocxSemanticState(
  value: unknown
): value is DocxSemanticState {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 'localmind-office-docx-state/v1' &&
    value.modelVersion === 'localmind-office-docx-model/v1' &&
    Array.isArray(value.body) &&
    Array.isArray(value.styles) &&
    Array.isArray(value.sections) &&
    isRecord(value.package) &&
    isRecord(value.compatibility) &&
    isRecord(value.stats)
  );
}

export function isXlsxSemanticState(
  value: unknown
): value is XlsxSemanticState {
  return (
    isRecord(value) &&
    value.schemaVersion === 'localmind-office-xlsx-state/v1' &&
    value.modelVersion === 'localmind-office-xlsx-model/v1' &&
    Array.isArray(value.sheets) &&
    isRecord(value.styles) &&
    isRecord(value.package) &&
    isRecord(value.compatibility) &&
    isRecord(value.stats)
  );
}

export function isPptxSemanticState(
  value: unknown
): value is PptxSemanticState {
  return (
    isRecord(value) &&
    value.schemaVersion === 'localmind-office-pptx-state/v1' &&
    value.modelVersion === 'localmind-office-pptx-model/v1' &&
    Array.isArray(value.slides) &&
    Array.isArray(value.masters) &&
    isRecord(value.slideSize) &&
    isRecord(value.package) &&
    isRecord(value.compatibility) &&
    isRecord(value.stats)
  );
}

export function isPdfSemanticState(value: unknown): value is PdfSemanticState {
  return (
    isRecord(value) &&
    value.schemaVersion === 'localmind-office-pdf-state/v1' &&
    value.modelVersion === 'localmind-office-pdf-model/v1' &&
    Array.isArray(value.pages) &&
    Array.isArray(value.formFields) &&
    isRecord(value.metadata) &&
    isRecord(value.compatibility) &&
    isRecord(value.stats)
  );
}

export function isNativeOfficeState(
  value: unknown,
  kind?: OfficeArtifactKindValue
): value is NativeOfficeState {
  if (kind === 'document') return isDocxSemanticState(value);
  if (kind === 'workbook') return isXlsxSemanticState(value);
  if (kind === 'presentation') return isPptxSemanticState(value);
  if (kind === 'pdf') return isPdfSemanticState(value);
  return (
    isDocxSemanticState(value) ||
    isXlsxSemanticState(value) ||
    isPptxSemanticState(value) ||
    isPdfSemanticState(value)
  );
}

export function docxRunContentText(content: readonly DocxRunContent[]) {
  return content
    .map(item => {
      switch (item.type) {
        case 'text':
          return item.text;
        case 'tab':
          return '\t';
        case 'break':
          return '\n';
        case 'noBreakHyphen':
          return '\u2011';
        case 'softHyphen':
          return '\u00ad';
        default:
          return '';
      }
    })
    .join('');
}

export function collectDocxParagraphs(
  blocks: readonly DocxBlock[],
  output: DocxParagraph[] = []
) {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      output.push(block);
    } else if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          collectDocxParagraphs(cell.blocks, output);
        }
      }
    } else if (block.type === 'contentControl') {
      collectDocxParagraphs(block.blocks, output);
    }
  }
  return output;
}
