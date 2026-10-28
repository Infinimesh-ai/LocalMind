/**
 * @vitest-environment happy-dom
 */
import type { XlsxSemanticState } from '@affine/core/modules/office';
import { getOrCreateI18n } from '@affine/i18n';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import type { OfficeEditorDraft } from './edit-draft';
import * as officeCommands from './shared';
import { cellDisplay, SpreadsheetEditor } from './spreadsheet';

vi.mock('@affine/component', async () => ({
  isComposingKeyboardEvent: (await import('@affine/component/ui/input'))
    .isComposingKeyboardEvent,
  Button: ({
    children,
    loading: _loading,
    variant: _variant,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean;
      variant?: string;
    }
  >) => <button {...props}>{children}</button>,
  IconButton: ({
    children,
    size: _size,
    tooltip: _tooltip,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      size?: string;
      tooltip?: string;
    }
  >) => <button {...props}>{children}</button>,
}));

vi.mock('./spreadsheet-chart', () => ({
  SpreadsheetChart: ({ chart }: { chart: { title?: string } }) => (
    <div role="img" aria-label={chart.title} />
  ),
}));

vi.mock('@blocksuite/icons/rc', () => ({
  ArrowDownSmallIcon: () => null,
  ArrowUpSmallIcon: () => null,
  BoldIcon: () => null,
  ChartPanelIcon: () => null,
  DeleteIcon: () => null,
  FilterIcon: () => null,
  InsertAboveIcon: () => null,
  InsertBelowIcon: () => null,
  InsertLeftIcon: () => null,
  InsertRightIcon: () => null,
  ItalicIcon: () => null,
  PlusIcon: () => null,
  TableIcon: () => null,
}));

const state = {
  schemaVersion: 'localmind-office-xlsx-state/v1',
  modelVersion: 'localmind-office-xlsx-model/v1',
  workbookPart: 'xl/workbook.xml',
  activeSheetIndex: 0,
  sheets: [
    {
      id: 'sheet-1',
      name: 'Budget',
      relationshipId: 'rId1',
      part: 'xl/worksheets/sheet1.xml',
      cells: [
        {
          address: 'D2',
          row: 2,
          column: 4,
          type: 'number',
          value: 10,
          styleIndex: 1,
        },
      ],
      rows: [],
      columns: [],
      mergedCells: [],
      dataValidations: [],
      tables: [],
      charts: [],
    },
  ],
  definedNames: [],
  styles: {
    fonts: [
      { name: 'Aptos', sizePt: 11 },
      {
        name: 'Inter',
        sizePt: 18,
        bold: true,
        italic: true,
        underline: 'single',
        color: '#0057B8',
      },
    ],
    fills: [
      { pattern: 'none' },
      { pattern: 'solid', foregroundColor: '#FFEEAA' },
    ],
    cells: [
      { index: 0, fontId: 0, fillId: 0 },
      {
        index: 1,
        fontId: 1,
        fillId: 1,
        horizontalAlignment: 'right',
        wrapText: true,
      },
    ],
  },
  package: { parts: [], opaqueParts: [], externalRelationships: [] },
  compatibility: { unsupportedFormulaFunctions: [], calculationErrors: 0 },
  stats: {
    sheets: 1,
    cells: 1,
    formulas: 0,
    calculatedFormulas: 0,
    styles: 2,
    tables: 0,
    charts: 0,
    validations: 0,
    packageParts: 0,
    opaqueParts: 0,
  },
} as XlsxSemanticState;

describe('SpreadsheetEditor', () => {
  const clipboardProps = () => ({
    state,
    revision: { id: 'revision-1', sequence: 1 } as never,
    artifactId: 'artifact-1',
    owner: { kind: 'workspace' as const, workspaceId: 'workspace-1' },
    graphql: {} as never,
    readOnly: false,
    onRevision: vi.fn(),
    onCommentAnchorChange: vi.fn(),
    onAiSelectionChange: vi.fn(),
  });
  const paste = (text: string) =>
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { types: ['text/plain'], getData: () => text },
    });

  test('pastes a rectangle as one user batch and restores the resulting selection', async () => {
    const props = clipboardProps();
    const execute = vi
      .spyOn(officeCommands, 'executeAndReloadOfficeCommand')
      .mockResolvedValue({
        state,
        revision: { id: 'revision-2', sequence: 2 } as never,
        preview: undefined,
        summary: {},
      });
    try {
      render(<SpreadsheetEditor {...props} />);
      paste('Name\tCount\n海棠\t25');
      await waitFor(() => expect(props.onRevision).toHaveBeenCalledOnce());
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0][0].command).toMatchObject({
        version: 'localmind-office-command-batch/v1',
        source: 'user',
        expectedRevisionId: 'revision-1',
        commands: expect.arrayContaining([
          expect.objectContaining({
            target: { type: 'cell', sheetId: 'sheet-1', address: 'B2' },
            input: { type: 'number', value: 25 },
          }),
        ]),
      });
      expect(
        (screen.getByLabelText('Selected cell range') as HTMLInputElement).value
      ).toBe('A1:B2');
      expect(screen.queryByRole('button', { name: 'Retry paste' })).toBeNull();
    } finally {
      execute.mockRestore();
    }
  });

  test('failed paste keeps a draft and retries the identical idempotency evidence', async () => {
    const props = clipboardProps();
    let draft: OfficeEditorDraft | undefined;
    const execute = vi
      .spyOn(officeCommands, 'executeAndReloadOfficeCommand')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        state,
        revision: { id: 'revision-2', sequence: 2 } as never,
        preview: undefined,
        summary: {},
      });
    try {
      render(
        <SpreadsheetEditor
          {...props}
          registerDraft={value => {
            draft = value;
            return () => {};
          }}
        />
      );
      paste('10\t20');
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Retry paste' })
        ).toBeDefined()
      );
      await waitFor(() => expect(execute).toHaveBeenCalledOnce());
      expect(draft?.hasUnsavedChanges).toBe(true);
      paste('replacement');
      expect(execute).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: 'Retry paste' }));
      await waitFor(() => expect(props.onRevision).toHaveBeenCalledOnce());
      expect(execute.mock.calls[1][0].command).toBe(
        execute.mock.calls[0][0].command
      );
      expect(draft?.hasUnsavedChanges).toBe(false);
    } finally {
      execute.mockRestore();
    }
  });

  test('readonly, invalid and merged paste targets never submit mutations', () => {
    const execute = vi.spyOn(officeCommands, 'executeAndReloadOfficeCommand');
    const props = clipboardProps();
    try {
      const view = render(<SpreadsheetEditor {...props} readOnly />);
      paste('10\t20');
      expect(
        screen.getByText('This workbook is read-only. Nothing was pasted.')
      ).toBeDefined();
      view.rerender(<SpreadsheetEditor {...props} />);
      paste('a\tb\nc');
      const merged = structuredClone(state);
      merged.sheets[0].mergedCells = ['A1:B1'];
      view.rerender(<SpreadsheetEditor {...props} state={merged} />);
      paste('10\t20');
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
    }
  });

  test('copy uses the selected rectangle values while readonly', () => {
    render(<SpreadsheetEditor {...clipboardProps()} readOnly />);
    fireEvent.change(screen.getByLabelText('Selected cell range'), {
      target: { value: 'C2:D2' },
    });
    const setData = vi.fn();
    fireEvent.copy(screen.getByRole('grid'), { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', '\t10');
  });

  test('an in-flight paste blocks a second submission and discard releases failed draft', async () => {
    let reject: ((error: Error) => void) | undefined;
    const execute = vi
      .spyOn(officeCommands, 'executeAndReloadOfficeCommand')
      .mockImplementation(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          })
      );
    let draft: OfficeEditorDraft | undefined;
    try {
      render(
        <SpreadsheetEditor
          {...clipboardProps()}
          registerDraft={value => {
            draft = value;
            return () => {};
          }}
        />
      );
      paste('10\t20');
      paste('30\t40');
      expect(execute).toHaveBeenCalledOnce();
      await act(async () => reject?.(new Error('offline')));
      fireEvent.click(
        screen.getByRole('button', { name: 'Discard paste draft' })
      );
      expect(draft?.hasUnsavedChanges).toBe(false);
      expect(screen.queryByRole('button', { name: 'Retry paste' })).toBeNull();
    } finally {
      execute.mockRestore();
    }
  });

  test('save status belongs to its revision and cannot survive a later AI revision', async () => {
    const updated = structuredClone(state);
    updated.sheets[0].cells[0].value = 20;
    const resultRevision = { id: 'revision-2', sequence: 2 } as never;
    const execute = vi
      .spyOn(officeCommands, 'executeAndReloadOfficeCommand')
      .mockResolvedValue({
        revision: resultRevision,
        state: updated,
        preview: undefined,
        summary: {},
      });
    try {
      const props = {
        state,
        revision: { id: 'revision-1', sequence: 1 } as never,
        artifactId: 'artifact-1',
        owner: { kind: 'workspace' as const, workspaceId: 'workspace-1' },
        graphql: {} as never,
        readOnly: false,
        onRevision: vi.fn(),
        onCommentAnchorChange: vi.fn(),
        onAiSelectionChange: vi.fn(),
      };
      const view = render(<SpreadsheetEditor {...props} />);
      fireEvent.click(screen.getByRole('gridcell', { name: 'D2: 10' }));
      fireEvent.change(screen.getByLabelText('Cell value or formula'), {
        target: { value: '20' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save cell' }));
      await waitFor(() => expect(props.onRevision).toHaveBeenCalledOnce());
      view.rerender(
        <SpreadsheetEditor
          {...props}
          state={updated}
          revision={resultRevision}
        />
      );
      expect(screen.getByRole('status').textContent).toContain(
        'D2 saved in revision 2'
      );
      const aiState = structuredClone(updated);
      aiState.sheets[0].cells[0].value = 25;
      view.rerender(
        <SpreadsheetEditor
          {...props}
          state={aiState}
          revision={{ id: 'revision-3', sequence: 3 } as never}
        />
      );
      expect(screen.getByRole('gridcell', { name: 'D2: 25' })).toBeDefined();
      expect(screen.getByRole('status').textContent).not.toContain(
        'saved in revision 2'
      );
      expect(screen.getByRole('status').textContent).toContain('Ready');
    } finally {
      execute.mockRestore();
    }
  });

  test('number formats change display without changing values or formulas', () => {
    const custom = structuredClone(state);
    const cell = custom.sheets[0].cells[0];
    for (const [numberFormatId, value, expected] of [
      [0, 12.5, '12.5'],
      [1, 12.5, '13'],
      [2, 12.5, '12.50'],
      [3, 1234.5, '1,235'],
      [4, 1234.5, '1,234.50'],
      [9, 0.125, '13%'],
      [10, 0.125, '12.50%'],
      [11, 1234.5, '1.23E+03'],
      [49, 12.5, '12.5'],
      [165, 12.5, '12.5'],
    ] as const) {
      custom.styles.cells[1].numberFormatId = numberFormatId;
      cell.value = value;
      expect(cellDisplay(cell, custom)).toBe(expected);
      expect(cell.value).toBe(value);
    }
    custom.styles.cells[1].numberFormatId = 10;
    cell.formula = '1/8';
    cell.calculatedValue = 0.125;
    expect(cellDisplay(cell, custom)).toBe('12.50%');
    expect(cell.formula).toBe('1/8');
    cell.calculationError = 'XLSX formula contains a circular reference';
    expect(cellDisplay(cell, custom)).toBe('#CYCLE!');
  });

  test('preserves imported number formats and submits the selected format for the selected range', async () => {
    const custom = structuredClone(state);
    custom.styles.cells[1].numberFormatId = 165;
    const gql = vi
      .fn()
      .mockRejectedValue(new Error('Isolated preview failure'));
    render(
      <SpreadsheetEditor
        state={custom}
        revision={{ id: 'revision-1', sequence: 1 } as never}
        artifactId="artifact-1"
        owner={{ kind: 'workspace', workspaceId: 'workspace-1' }}
        graphql={{ gql } as never}
        readOnly={false}
        onRevision={vi.fn()}
        onCommentAnchorChange={vi.fn()}
        onAiSelectionChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('gridcell', { name: 'D2: 10' }));
    expect(
      screen.getByLabelText<HTMLSelectElement>('Number format').value
    ).toBe('165');
    expect(
      screen.getByText(/date and custom format previews are not supported/)
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText('Selected cell range'), {
      target: { value: 'D2:E3' },
    });
    fireEvent.change(screen.getByLabelText('Number format'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply format' }));
    await waitFor(() => expect(gql).toHaveBeenCalledOnce());
    expect(gql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          input: expect.objectContaining({
            command: expect.objectContaining({
              operation: 'office.workbook.range.format',
              target: {
                type: 'cell_range',
                sheetId: 'sheet-1',
                range: 'D2:E3',
              },
              format: expect.objectContaining({ numberFormatId: 10 }),
            }),
          }),
        },
      })
    );
    // A failed preview does not claim a formatted value or lose the selection.
    expect(screen.getByRole('gridcell', { name: 'D2: 10' })).toBeDefined();
    expect(
      screen.getByLabelText<HTMLInputElement>('Selected cell range').value
    ).toBe('D2:E3');
  });

  test.each(['row', 'column'] as const)(
    'restores a hidden %s by its address with a versioned command',
    async axis => {
      const custom = structuredClone(state);
      custom.sheets[0].rows = [{ row: 2, hidden: true, heightPt: 40 }];
      custom.sheets[0].columns = [{ min: 4, max: 4, hidden: true, width: 24 }];
      const gql = vi
        .fn()
        .mockRejectedValue(new Error('Isolated preview failure'));
      const props = {
        state: custom,
        revision: { id: 'revision-1', sequence: 1 } as never,
        artifactId: 'artifact-1',
        owner: { kind: 'workspace' as const, workspaceId: 'workspace-1' },
        graphql: { gql } as never,
        readOnly: false,
        onRevision: vi.fn(),
        onCommentAnchorChange: vi.fn(),
        onAiSelectionChange: vi.fn(),
      };
      const { rerender } = render(<SpreadsheetEditor {...props} />);
      fireEvent.change(screen.getByLabelText('Active cell address'), {
        target: { value: 'D2' },
      });
      const checkbox = screen.getByLabelText<HTMLInputElement>(
        `Hide current ${axis}`
      );
      expect(checkbox.checked).toBe(true);
      expect(
        screen.getByLabelText<HTMLInputElement>('Cell value or formula').value
      ).toBe('10');
      fireEvent.click(checkbox);
      await waitFor(() => expect(gql).toHaveBeenCalledOnce());
      expect(gql).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: {
            input: expect.objectContaining({
              command: expect.objectContaining({
                operation: `office.workbook.${axis}.properties.set`,
                hidden: false,
                sheetId: 'sheet-1',
                expectedRevisionId: 'revision-1',
                ...(axis === 'row'
                  ? { row: 2 }
                  : { startColumn: 4, endColumn: 4 }),
              }),
            }),
          },
        })
      );
      rerender(<SpreadsheetEditor {...props} readOnly />);
      expect(checkbox.closest('fieldset')?.disabled).toBe(true);
    }
  );

  test('read-only viewers can open a chart while deletion remains disabled', () => {
    const custom = structuredClone(state);
    custom.sheets[0].charts = [
      {
        id: 'chart-1',
        title: '数量图',
        type: 'column',
        part: 'chart.xml',
        drawingPart: 'drawing.xml',
        series: [],
      },
    ];
    render(
      <SpreadsheetEditor
        state={custom}
        revision={{ id: 'revision-1', sequence: 1 } as never}
        artifactId="artifact-1"
        owner={{ kind: 'workspace', workspaceId: 'workspace-1' }}
        graphql={{} as never}
        readOnly={true}
        onRevision={vi.fn()}
        onCommentAnchorChange={vi.fn()}
        onAiSelectionChange={vi.fn()}
      />
    );
    const view = screen.getByRole('button', { name: /^数量图/ });
    expect((view as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(view);
    expect(screen.getByRole('img', { name: '数量图' })).toBeDefined();
    expect(
      (
        screen.getByRole('button', {
          name: 'Delete 数量图 chart',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  test('filters data rows while preserving headers, outside rows, and manual hidden rows', () => {
    const custom = structuredClone(state);
    custom.sheets[0].cells.push(
      {
        address: 'D3',
        row: 3,
        column: 4,
        type: 'number',
        value: null,
        formula: '5*2',
        calculatedValue: 10,
      },
      { address: 'D4', row: 4, column: 4, type: 'number', value: 20 }
    );
    custom.sheets[0].rows = [{ row: 5, hidden: true }];
    custom.sheets[0].autoFilter = {
      ref: 'C1:D4',
      criteria: [{ columnIndex: 1, values: ['10'] }],
    };
    const props = {
      state: custom,
      revision: { id: 'revision-1', sequence: 1 } as never,
      artifactId: 'artifact-1',
      owner: { kind: 'workspace' as const, workspaceId: 'workspace-1' },
      graphql: {} as never,
      readOnly: false,
      onRevision: vi.fn(),
      onCommentAnchorChange: vi.fn(),
      onAiSelectionChange: vi.fn(),
    };
    const { rerender } = render(<SpreadsheetEditor {...props} />);
    expect(screen.getByRole('gridcell', { name: /^A1:/ })).toBeDefined();
    expect(screen.getByRole('gridcell', { name: 'D2: 10' })).toBeDefined();
    expect(screen.getByRole('gridcell', { name: 'D3: 10' })).toBeDefined();
    expect(screen.queryByRole('gridcell', { name: /^A4:/ })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: /^A5:/ })).toBeNull();
    expect(screen.getByRole('gridcell', { name: /^A6:/ })).toBeDefined();
    const cleared = structuredClone(custom);
    delete cleared.sheets[0].autoFilter;
    rerender(<SpreadsheetEditor {...props} state={cleared} />);
    expect(screen.getByRole('gridcell', { name: /^A4:/ })).toBeDefined();
    expect(screen.queryByRole('gridcell', { name: /^A5:/ })).toBeNull();
  });

  test.each(['Invalid', '="Invalid"'])(
    'keeps invalid validation draft %s and explains the rule without a write',
    async invalid => {
      const custom = structuredClone(state);
      custom.sheets[0].dataValidations = [
        { range: 'A1:A2', type: 'list', formula1: '"Yes,No"' },
      ];
      const gql = vi.fn();
      render(
        <SpreadsheetEditor
          state={custom}
          revision={{ id: 'revision-1', sequence: 1 } as never}
          artifactId="artifact-1"
          owner={{ kind: 'workspace', workspaceId: 'workspace-1' }}
          graphql={{ gql } as never}
          readOnly={false}
          onRevision={vi.fn()}
          onCommentAnchorChange={vi.fn()}
          onAiSelectionChange={vi.fn()}
        />
      );
      const input = screen.getByLabelText<HTMLInputElement>(
        'Cell value or formula'
      );
      expect(
        screen.getByLabelText<HTMLInputElement>('Validation list values').value
      ).toBe('Yes,No');
      fireEvent.change(input, { target: { value: invalid } });
      fireEvent.click(screen.getByRole('button', { name: 'Save cell' }));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain(
          'This value does not meet the cell’s validation rule. Your draft has been kept.'
        )
      );
      expect(input.value).toBe(invalid);
      expect(gql).not.toHaveBeenCalled();
    }
  );

  test('renders merged spans with persisted dimensions and restores independent cells after unmerge', () => {
    const custom = structuredClone(state);
    custom.sheets[0].mergedCells = ['D2:E3'];
    custom.sheets[0].rows = [{ row: 2, heightPt: 40 }];
    custom.sheets[0].columns = [{ min: 4, max: 4, width: 24 }];
    const gql = vi.fn();
    const props = {
      state: custom,
      revision: { id: 'revision-1', sequence: 1 } as never,
      artifactId: 'artifact-1',
      owner: { kind: 'workspace' as const, workspaceId: 'workspace-1' },
      graphql: { gql } as never,
      readOnly: false,
      onRevision: vi.fn(),
      onCommentAnchorChange: vi.fn(),
      onAiSelectionChange: vi.fn(),
    };
    const { rerender } = render(<SpreadsheetEditor {...props} />);
    const anchor = screen.getByRole('gridcell', { name: 'D2: 10' });
    expect(anchor.getAttribute('aria-rowspan')).toBe('2');
    expect(anchor.getAttribute('aria-colspan')).toBe('2');
    expect(screen.queryByRole('gridcell', { name: /^E3:/ })).toBeNull();
    const grid = screen.getByRole('grid');
    expect(grid.style.gridTemplateRows.split(' ')[2]).toBe(`${(40 * 4) / 3}px`);
    expect(grid.style.gridTemplateColumns.split(' ')[4]).toBe('168px');
    fireEvent.click(anchor);
    expect(screen.getByLabelText<HTMLInputElement>('Row height').value).toBe(
      '40'
    );
    expect(screen.getByLabelText<HTMLInputElement>('Column width').value).toBe(
      '24'
    );
    fireEvent.blur(screen.getByLabelText('Row height'));
    fireEvent.blur(screen.getByLabelText('Column width'));
    expect(gql).not.toHaveBeenCalled();
    // A covered address is resolved to the merged anchor, including formula input.
    fireEvent.change(screen.getByLabelText('Active cell address'), {
      target: { value: 'E3' },
    });
    expect(
      screen.getByLabelText<HTMLInputElement>('Cell value or formula').value
    ).toBe('10');
    const unmerged = structuredClone(custom);
    unmerged.sheets[0].mergedCells = [];
    rerender(<SpreadsheetEditor {...props} state={unmerged} />);
    expect(screen.getByRole('gridcell', { name: /^E3:/ })).toBeDefined();
    expect(
      screen
        .getByRole('gridcell', { name: 'D2: 10' })
        .getAttribute('aria-colspan')
    ).toBeNull();
  });

  test('hidden rows and columns collapse merged spans without losing the anchor value', () => {
    const custom = structuredClone(state);
    custom.sheets[0].mergedCells = ['D2:F4'];
    custom.sheets[0].rows = [{ row: 2, hidden: true }];
    custom.sheets[0].columns = [{ min: 4, max: 4, hidden: true }];
    render(
      <SpreadsheetEditor
        state={custom}
        revision={{ id: 'revision-1', sequence: 1 } as never}
        artifactId="artifact-1"
        owner={{ kind: 'workspace', workspaceId: 'workspace-1' }}
        graphql={{} as never}
        readOnly={false}
        onRevision={vi.fn()}
        onCommentAnchorChange={vi.fn()}
        onAiSelectionChange={vi.fn()}
      />
    );
    const anchor = screen.getByRole('gridcell', { name: 'D2: 10' });
    expect(anchor.getAttribute('aria-rowspan')).toBe('2');
    expect(anchor.getAttribute('aria-colspan')).toBe('2');
    expect(anchor.style.whiteSpace).toBe('pre-wrap');
    expect(screen.queryByRole('gridcell', { name: /^A2:/ })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: /^D1:/ })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: /^F4:/ })).toBeNull();
  });

  test.each([
    ['=#REF!', 'This formula cannot be calculated.'],
    ['=SUM(', 'This formula cannot be calculated.'],
    [
      '=QA_UNSUPPORTED(1)',
      'This formula contains a function that is not supported yet.',
    ],
  ])(
    'explains invalid input %s without losing the draft or sending a command',
    async (formula, message) => {
      const gql = vi
        .fn()
        .mockRejectedValue(new Error('Isolated preview failure'));
      render(
        <SpreadsheetEditor
          state={state}
          revision={{ id: 'revision-1', sequence: 1 } as never}
          artifactId="artifact-1"
          owner={{ kind: 'workspace', workspaceId: 'workspace-1' }}
          graphql={{ gql } as never}
          readOnly={false}
          onRevision={vi.fn()}
          onCommentAnchorChange={vi.fn()}
          onAiSelectionChange={vi.fn()}
        />
      );
      const input = screen.getByLabelText<HTMLInputElement>(
        'Cell value or formula'
      );
      fireEvent.change(input, { target: { value: formula } });
      fireEvent.click(screen.getByRole('button', { name: 'Save cell' }));
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain(message)
      );
      expect(input.value).toBe(formula);
      expect(gql).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: '=SUM(1,2)' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save cell' }));
      await waitFor(() => expect(gql).toHaveBeenCalledOnce());
      expect(gql).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: {
            input: expect.objectContaining({
              command: expect.objectContaining({
                input: { type: 'formula', formula: 'SUM(1,2)' },
              }),
            }),
          },
        })
      );
    }
  );

  test.each([
    [
      'XLSX formula references a missing worksheet',
      '#REF!',
      'This formula cannot be calculated.',
    ],
    [
      'XLSX formula contains a circular reference',
      '#CYCLE!',
      'Circular reference:',
    ],
    [
      'XLSX formula function is unsupported: PRIVATE_FUNCTION',
      '#ERROR!',
      'This formula contains a function that is not supported yet.',
    ],
    [
      'XLSX formula expected a number',
      '#ERROR!',
      'This formula cannot be calculated.',
    ],
  ])(
    'shows saved calculation failure instead of an empty or stale value: %s',
    async (calculationError, marker, explanation) => {
      const invalidState = structuredClone(state);
      Object.assign(invalidState.sheets[0].cells[0], {
        formula: 'D2',
        calculatedValue: 999,
        calculationError,
      });
      render(
        <SpreadsheetEditor
          state={invalidState}
          revision={{ id: 'revision-1', sequence: 1 } as never}
          artifactId="artifact-1"
          owner={{ kind: 'project', projectId: 'project-1' }}
          graphql={{} as never}
          readOnly={true}
          onRevision={vi.fn()}
          onCommentAnchorChange={vi.fn()}
          onAiSelectionChange={vi.fn()}
        />
      );
      const cell = screen.getByRole('gridcell', { name: `D2: ${marker}` });
      expect(cell.textContent).toBe(marker);
      expect(cell.getAttribute('title')).toContain(explanation);
      fireEvent.click(cell);
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain(explanation)
      );
      expect(
        screen.getByLabelText<HTMLInputElement>('Cell value or formula').value
      ).toBe('=D2');
      expect(screen.queryByText('PRIVATE_FUNCTION')).toBeNull();
    }
  );

  test('IME confirmation never saves a partially composed cell value', async () => {
    const gql = vi
      .fn()
      .mockRejectedValue(new Error('Isolated preview failure'));
    render(
      <SpreadsheetEditor
        state={state}
        revision={{ id: 'revision-1', sequence: 1 } as never}
        artifactId="artifact-1"
        owner={{ kind: 'project', projectId: 'project-1' }}
        graphql={{ gql } as never}
        readOnly={false}
        onRevision={vi.fn()}
        onCommentAnchorChange={vi.fn()}
        onAiSelectionChange={vi.fn()}
      />
    );
    const input = screen.getByLabelText<HTMLInputElement>(
      'Cell value or formula'
    );
    fireEvent.change(input, { target: { value: '完整中文内容' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    expect(gql).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(gql).toHaveBeenCalledOnce());
    expect(gql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          input: expect.objectContaining({
            command: expect.objectContaining({
              input: { type: 'string', value: '完整中文内容' },
            }),
          }),
        },
      })
    );
    expect(input.value).toBe('完整中文内容');
  });
  test('Project cell drafts can be discarded without a write', async () => {
    const guards = new Set<OfficeEditorDraft>();
    const gql = vi.fn();
    const confirm = vi.fn(async () => false);
    render(
      <SpreadsheetEditor
        state={state}
        revision={{ id: 'revision-1', sequence: 1 } as never}
        artifactId="artifact-1"
        owner={{ kind: 'project', projectId: 'project-1' }}
        graphql={{ gql } as never}
        readOnly={false}
        onRevision={vi.fn()}
        onCommentAnchorChange={vi.fn()}
        onAiSelectionChange={vi.fn()}
        beforeSelectionChange={confirm}
        registerDraft={guard => {
          guards.add(guard);
          return () => {
            guards.delete(guard);
          };
        }}
      />
    );
    const formula = screen.getByLabelText<HTMLInputElement>(
      'Cell value or formula'
    );
    fireEvent.change(formula, { target: { value: '=SUM(A2:A4)' } });
    const guard = [...guards][0];
    expect(guard.hasUnsavedChanges).toBe(true);
    fireEvent.click(screen.getByRole('gridcell', { name: /^B1:/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(formula.value).toBe('=SUM(A2:A4)');
    expect(
      screen.getByLabelText<HTMLInputElement>('Active cell address').value
    ).toBe('A1');
    await act(() => guard.discard());
    expect(guard.hasUnsavedChanges).toBe(false);
    expect(formula.value).toBe('');
    expect(gql).not.toHaveBeenCalled();
  });
  afterEach(cleanup);

  test('loads the selected cell format into the editing controls', async () => {
    render(
      <SpreadsheetEditor
        state={state}
        revision={{ id: 'revision-1', sequence: 1 } as never}
        artifactId="artifact-1"
        owner={{ kind: 'workspace', workspaceId: 'workspace-1' }}
        graphql={{} as never}
        readOnly={false}
        onRevision={vi.fn()}
        onCommentAnchorChange={vi.fn()}
        onAiSelectionChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('gridcell', { name: 'D2: 10' }));

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Font').value).toBe(
        'Inter'
      );
    });
    expect(screen.getByLabelText<HTMLInputElement>('Size').value).toBe('18');
    expect(screen.getByLabelText<HTMLInputElement>('Text').value).toBe(
      '#0057b8'
    );
    expect(screen.getByLabelText<HTMLInputElement>('Fill').value).toBe(
      '#ffeeaa'
    );
    expect(
      screen.getByLabelText<HTMLSelectElement>('Horizontal alignment').value
    ).toBe('right');
    expect(screen.getByLabelText<HTMLInputElement>('Wrap text').checked).toBe(
      true
    );
    expect(screen.getByRole('button', { name: 'Bold' }).dataset.active).toBe(
      'true'
    );
    expect(screen.getByRole('button', { name: 'Italic' }).dataset.active).toBe(
      'true'
    );
    expect(
      screen.getByRole('button', { name: 'Underline' }).dataset.active
    ).toBe('true');
  });

  test('switching to Chinese keeps the draft and double-click focuses the formula input', async () => {
    const i18n = getOrCreateI18n();
    render(
      <SpreadsheetEditor
        state={state}
        revision={{ id: 'revision-1', sequence: 1 } as never}
        artifactId="artifact-1"
        owner={{ kind: 'project', projectId: 'project-1' }}
        graphql={{} as never}
        readOnly={false}
        onRevision={vi.fn()}
        onCommentAnchorChange={vi.fn()}
        onAiSelectionChange={vi.fn()}
      />
    );
    const formula = screen.getByLabelText<HTMLInputElement>(
      'Cell value or formula'
    );
    fireEvent.change(formula, { target: { value: '=SUM(A2:A4)' } });
    try {
      await act(() => i18n.changeLanguage('zh-Hans'));
      expect(screen.getByLabelText('单元格值或公式')).toBe(formula);
      expect(formula.value).toBe('=SUM(A2:A4)');
      fireEvent.doubleClick(screen.getByRole('gridcell', { name: /^A1:/ }));
      await waitFor(() => expect(document.activeElement).toBe(formula));
      expect(screen.getByRole('button', { name: '保存单元格' })).toBeDefined();
      expect(screen.getByText('就绪')).toBeDefined();
      expect(
        screen.getByRole('gridcell', { name: 'A1: 空单元格' })
      ).toBeDefined();
    } finally {
      await act(() => i18n.changeLanguage('en'));
    }
  });
});

beforeAll(async () => {
  await getOrCreateI18n().changeLanguage('en');
});
