import {
  type DocxSemanticState,
  isDocxSemanticState,
  isPdfSemanticState,
  isPptxSemanticState,
  isXlsxSemanticState,
  type NativeOfficeState,
  type OfficeArtifactKindValue,
  type PdfSemanticState,
  type PptxSemanticState,
  type XlsxSemanticState,
} from '@affine/core/modules/office';
import type { ReactNode } from 'react';

export type OfficeEditorSurfaceProps = {
  kind: OfficeArtifactKindValue;
  state: NativeOfficeState;
  renderDocument: (state: DocxSemanticState) => ReactNode;
  renderWorkbook: (state: XlsxSemanticState) => ReactNode;
  renderPresentation: (state: PptxSemanticState) => ReactNode;
  renderPdf: (state: PdfSemanticState) => ReactNode;
  renderUnsupported: () => ReactNode;
};

/**
 * Selects the native editor from the persisted artifact kind and semantic
 * state. Workspace and Project both use this boundary so a format cannot
 * silently render through a different editor when its stored state is stale.
 */
export function OfficeEditorSurface({
  kind,
  state,
  renderDocument,
  renderWorkbook,
  renderPresentation,
  renderPdf,
  renderUnsupported,
}: OfficeEditorSurfaceProps) {
  if (kind === 'document' && isDocxSemanticState(state)) {
    return renderDocument(state);
  }
  if (kind === 'workbook' && isXlsxSemanticState(state)) {
    return renderWorkbook(state);
  }
  if (kind === 'presentation' && isPptxSemanticState(state)) {
    return renderPresentation(state);
  }
  if (kind === 'pdf' && isPdfSemanticState(state)) {
    return renderPdf(state);
  }
  return renderUnsupported();
}
