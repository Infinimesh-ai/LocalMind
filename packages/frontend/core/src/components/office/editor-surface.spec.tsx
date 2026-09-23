/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type {
  NativeOfficeState,
  OfficeArtifactKindValue,
} from '../../modules/office';
import { OfficeEditorSurface } from './editor-surface';

const commonState = {
  package: {},
  compatibility: {},
  stats: {},
};

const states: Record<OfficeArtifactKindValue, NativeOfficeState> = {
  document: {
    ...commonState,
    schemaVersion: 'localmind-office-docx-state/v1',
    modelVersion: 'localmind-office-docx-model/v1',
    body: [],
    styles: [],
    sections: [],
  } as unknown as NativeOfficeState,
  workbook: {
    ...commonState,
    schemaVersion: 'localmind-office-xlsx-state/v1',
    modelVersion: 'localmind-office-xlsx-model/v1',
    sheets: [],
    styles: {},
  } as unknown as NativeOfficeState,
  presentation: {
    ...commonState,
    schemaVersion: 'localmind-office-pptx-state/v1',
    modelVersion: 'localmind-office-pptx-model/v1',
    slides: [],
    masters: [],
    slideSize: {},
  } as unknown as NativeOfficeState,
  pdf: {
    ...commonState,
    schemaVersion: 'localmind-office-pdf-state/v1',
    modelVersion: 'localmind-office-pdf-model/v1',
    pages: [],
    formFields: [],
    metadata: {},
  } as unknown as NativeOfficeState,
};

afterEach(cleanup);

describe('OfficeEditorSurface', () => {
  test.each(Object.keys(states) as OfficeArtifactKindValue[])(
    'routes %s state through the matching shared editor boundary',
    kind => {
      const renders = {
        document: vi.fn(() => <span>document editor</span>),
        workbook: vi.fn(() => <span>workbook editor</span>),
        presentation: vi.fn(() => <span>presentation editor</span>),
        pdf: vi.fn(() => <span>pdf editor</span>),
      };
      render(
        <OfficeEditorSurface
          kind={kind}
          state={states[kind]}
          renderDocument={renders.document}
          renderWorkbook={renders.workbook}
          renderPresentation={renders.presentation}
          renderPdf={renders.pdf}
          renderUnsupported={() => <span>unsupported</span>}
        />
      );
      expect(screen.getByText(`${kind} editor`)).toBeDefined();
      expect(renders[kind]).toHaveBeenCalledOnce();
    }
  );

  test('rejects a semantic state that does not match the artifact kind', () => {
    render(
      <OfficeEditorSurface
        kind="document"
        state={states.workbook}
        renderDocument={() => <span>document editor</span>}
        renderWorkbook={() => <span>workbook editor</span>}
        renderPresentation={() => <span>presentation editor</span>}
        renderPdf={() => <span>pdf editor</span>}
        renderUnsupported={() => <span>unsupported</span>}
      />
    );
    expect(screen.getByText('unsupported')).toBeDefined();
  });
});
