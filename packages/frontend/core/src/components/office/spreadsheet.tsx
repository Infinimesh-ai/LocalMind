import {
  Button,
  IconButton,
  isComposingKeyboardEvent,
} from '@affine/component';
import type {
  OfficeCommand,
  OfficeWorkbookSetCellCommand,
  XlsxCell,
  XlsxSemanticState,
} from '@affine/core/modules/office';
import { I18n, useI18n } from '@affine/i18n';
import {
  ArrowDownSmallIcon,
  ArrowUpSmallIcon,
  BoldIcon,
  ChartPanelIcon,
  DeleteIcon,
  FilterIcon,
  InsertAboveIcon,
  InsertBelowIcon,
  InsertLeftIcon,
  InsertRightIcon,
  ItalicIcon,
  PlusIcon,
  TableIcon,
} from '@blocksuite/icons/rc';
import type { OfficeCommandBatch } from '@localmind/office';
import {
  columnIndexToName,
  evaluateXlsxFormula,
  parseCellAddress,
  parseXlsxFormula,
  validateXlsxCellValue,
  xlsxRangeContains,
} from '@localmind/office/xlsx';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useOfficeEditorDraft, useOfficeSelectionChange } from './edit-draft';
import {
  executeAndReloadOfficeCommand,
  type NativeOfficeEditorProps,
  officeErrorMessage,
} from './shared';
import { SpreadsheetChart } from './spreadsheet-chart';
import {
  copySpreadsheetValues,
  parseSpreadsheetInput,
  SpreadsheetClipboardError,
  spreadsheetPasteBatch,
} from './spreadsheet-clipboard';
import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_ROW_HEIGHT,
  mergedCellAddress,
  worksheetDimensions,
  worksheetLayout,
} from './spreadsheet-layout';
import * as styles from './surface.css';

const numberFormats = [
  [0, 'General'],
  [1, '0'],
  [2, '0.00'],
  [3, '#,##0'],
  [4, '#,##0.00'],
  [9, '0%'],
  [10, '0.00%'],
  [11, '0.00E+00'],
  [49, '@'],
] as const;

export function cellDisplay(
  cell: XlsxCell | undefined,
  state?: XlsxSemanticState
) {
  if (!cell) return '';
  if (cell.formula && cell.calculationError) {
    return cell.calculationError ===
      'XLSX formula contains a circular reference'
      ? '#CYCLE!'
      : '#ERROR!';
  }
  const value = cell.formula ? cell.calculatedValue : cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const formatId =
      cell.styleIndex === undefined
        ? 0
        : (state?.styles.cells[cell.styleIndex]?.numberFormatId ?? 0);
    if ([1, 2, 3, 4, 9, 10].includes(formatId)) {
      const digits = [2, 4, 10].includes(formatId) ? 2 : 0;
      return new Intl.NumberFormat('en-US', {
        style: formatId === 9 || formatId === 10 ? 'percent' : 'decimal',
        useGrouping: formatId === 3 || formatId === 4,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    }
    if (formatId === 11) {
      return value
        .toExponential(2)
        .replace(
          /e([+-])(\d+)$/,
          (_: string, sign: string, exp: string) =>
            `E${sign}${exp.padStart(2, '0')}`
        );
    }
  }
  return String(value);
}

function formulaErrorMessage(error: string) {
  if (error === 'XLSX formula contains a circular reference') {
    return I18n['com.affine.office.formula-circular-reference']();
  }
  if (error.startsWith('XLSX formula function is unsupported:')) {
    return I18n['com.affine.office.formula-unsupported-function']();
  }
  return I18n['com.affine.office.formula-invalid']();
}

function cellInput(cell: XlsxCell | undefined) {
  if (!cell) return '';
  if (cell.formula) return `=${cell.formula}`;
  if (cell.value === null || cell.value === undefined) return '';
  return String(cell.value);
}

function sheetFormulaRange(sheetName: string, range: string) {
  if (range.includes('!')) return range;
  const escaped = sheetName.replaceAll("'", "''");
  return `'${escaped}'!${range}`;
}

function tryParseCellAddress(
  input: string,
  sheet?: XlsxSemanticState['sheets'][number]
) {
  try {
    return mergedCellAddress(sheet, input);
  } catch {
    return undefined;
  }
}

function cellStyle(state: XlsxSemanticState, cell: XlsxCell | undefined) {
  if (cell?.styleIndex === undefined) return undefined;
  const style = state.styles.cells[cell.styleIndex];
  const font =
    style?.fontId === undefined ? undefined : state.styles.fonts[style.fontId];
  const fill =
    style?.fillId === undefined ? undefined : state.styles.fills[style.fillId];
  return {
    color: font?.color,
    fontFamily: font?.name,
    fontSize: font?.sizePt ? `${font.sizePt}pt` : undefined,
    fontWeight: font?.bold ? 700 : undefined,
    fontStyle: font?.italic ? 'italic' : undefined,
    textDecoration: font?.underline ? 'underline' : undefined,
    background: fill?.foregroundColor,
    whiteSpace: style?.wrapText ? 'pre-wrap' : undefined,
    overflowWrap: style?.wrapText ? 'anywhere' : undefined,
    justifyContent:
      style?.horizontalAlignment === 'center'
        ? 'center'
        : style?.horizontalAlignment === 'right'
          ? 'flex-end'
          : undefined,
  } as const;
}

export function cellFormatDraft(
  state: XlsxSemanticState,
  cell: XlsxCell | undefined
) {
  const style =
    cell?.styleIndex === undefined
      ? undefined
      : state.styles.cells[cell.styleIndex];
  const font =
    style?.fontId === undefined ? undefined : state.styles.fonts[style.fontId];
  const fill =
    style?.fillId === undefined ? undefined : state.styles.fills[style.fillId];
  const horizontalAlignment = style?.horizontalAlignment;
  const alignment: 'left' | 'center' | 'right' =
    horizontalAlignment === 'center' || horizontalAlignment === 'right'
      ? horizontalAlignment
      : 'left';

  return {
    fontFamily: font?.name ?? 'Aptos',
    fontSize: font?.sizePt ?? 11,
    bold: font?.bold ?? false,
    italic: font?.italic ?? false,
    underline: Boolean(font?.underline),
    textColor: font?.color ?? '#1F2329',
    fillColor: fill?.foregroundColor ?? '#FFFFFF',
    alignment,
    wrapText: style?.wrapText ?? false,
    numberFormatId: style?.numberFormatId ?? 0,
  };
}

export function SpreadsheetEditor({
  state,
  revision,
  artifactId,
  owner,
  graphql,
  readOnly,
  onRevision,
  onCommentAnchorChange,
  onAiSelectionChange,
  registerDraft,
  beforeSelectionChange,
}: NativeOfficeEditorProps<XlsxSemanticState>) {
  const i18n = useI18n();
  const changeSelection = useOfficeSelectionChange(beforeSelectionChange);
  const [activeSheetId, setActiveSheetId] = useState(
    state.sheets[state.activeSheetIndex]?.id ?? state.sheets[0]?.id ?? ''
  );
  const [activeAddress, setActiveAddress] = useState('A1');
  const [draft, setDraft] = useState('');
  const savedDraft = useRef('');
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const [range, setRange] = useState('A1:A1');
  const [fontFamily, setFontFamily] = useState('Aptos');
  const [fontSize, setFontSize] = useState(11);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [textColor, setTextColor] = useState('#1F2329');
  const [fillColor, setFillColor] = useState('#FFFFFF');
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>(
    'left'
  );
  const [wrapText, setWrapText] = useState(false);
  const [numberFormatId, setNumberFormatId] = useState(0);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [columnWidth, setColumnWidth] = useState(DEFAULT_COLUMN_WIDTH);
  const [dimensionCount, setDimensionCount] = useState(1);
  const [filterValues, setFilterValues] = useState('');
  const [validationValues, setValidationValues] = useState('');
  const [tableName, setTableName] = useState('LocalMindTable');
  const [chartType, setChartType] = useState<'column' | 'bar' | 'line' | 'pie'>(
    'column'
  );
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [categoryRange, setCategoryRange] = useState('A2:A10');
  const [valueRange, setValueRange] = useState('B2:B10');
  const [newSheetName, setNewSheetName] = useState('Sheet');
  const [sheetName, setSheetName] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pendingPaste = useRef<ReturnType<typeof spreadsheetPasteBatch> | null>(
    null
  );
  const [hasPendingPaste, setHasPendingPaste] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setRevisionStatus] = useState<{
    revisionId: string;
    message: string;
  } | null>(null);
  const setStatus = useCallback(
    (message: string, revisionId = revision.id) => {
      setRevisionStatus({ revisionId, message });
    },
    [revision.id]
  );
  const sheet =
    state.sheets.find(candidate => candidate.id === activeSheetId) ??
    state.sheets[0];
  const cells = useMemo(
    () => new Map(sheet?.cells.map(cell => [cell.address, cell]) ?? []),
    [sheet]
  );
  const parsedActiveAddress = useMemo(
    () => tryParseCellAddress(activeAddress, sheet),
    [activeAddress, sheet]
  );
  const activeCell = parsedActiveAddress
    ? cells.get(parsedActiveAddress.address)
    : undefined;

  useEffect(() => {
    if (registerDraft && currentDraft.current !== savedDraft.current) return;
    setDraft(cellInput(activeCell));
    savedDraft.current = cellInput(activeCell);
    currentDraft.current = cellInput(activeCell);
  }, [activeCell, parsedActiveAddress, registerDraft]);

  const selectedAddress = parsedActiveAddress?.address;
  useEffect(() => {
    if (selectedAddress) setRange(`${selectedAddress}:${selectedAddress}`);
  }, [selectedAddress, sheet?.id]);

  useEffect(() => {
    const format = cellFormatDraft(state, activeCell);
    setFontFamily(format.fontFamily);
    setFontSize(format.fontSize);
    setBold(format.bold);
    setItalic(format.italic);
    setUnderline(format.underline);
    setTextColor(format.textColor);
    setFillColor(format.fillColor);
    setAlignment(format.alignment);
    setWrapText(format.wrapText);
    setNumberFormatId(format.numberFormatId);
  }, [activeCell, state]);

  useEffect(() => {
    if (!sheet || !parsedActiveAddress) return;
    const dimensions = worksheetDimensions(
      sheet,
      parsedActiveAddress.row,
      parsedActiveAddress.column
    );
    setRowHeight(dimensions.row?.heightPt ?? DEFAULT_ROW_HEIGHT);
    setColumnWidth(dimensions.column?.width ?? DEFAULT_COLUMN_WIDTH);
  }, [sheet, parsedActiveAddress]);

  useEffect(() => {
    setSheetName(sheet?.name ?? '');
  }, [sheet?.name]);

  const activeValidation = sheet?.dataValidations.find(rule => {
    if (!parsedActiveAddress) return false;
    try {
      return xlsxRangeContains(rule.range, parsedActiveAddress.address);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const formula = activeValidation?.formula1 ?? '';
    setValidationValues(
      activeValidation?.type === 'list' &&
        formula.startsWith('"') &&
        formula.endsWith('"')
        ? formula.slice(1, -1).replaceAll('""', '"')
        : ''
    );
  }, [activeValidation, sheet?.id]);
  useEffect(() => {
    setFilterValues(sheet?.autoFilter?.criteria[0]?.values.join(',') ?? '');
  }, [sheet?.autoFilter, sheet?.id]);

  useEffect(() => {
    if (!sheet) {
      onCommentAnchorChange(null);
      onAiSelectionChange(null);
      return;
    }
    onCommentAnchorChange(
      parsedActiveAddress
        ? {
            kind: 'workbook',
            revisionId: revision.id,
            sheetId: sheet.id,
            address: parsedActiveAddress.address,
          }
        : null
    );
    if (!parsedActiveAddress) {
      onAiSelectionChange({
        kind: 'workbook',
        target: { type: 'sheet', sheetId: sheet.id },
      });
      return;
    }
    const normalizedRange = range.trim().toUpperCase();
    const singleCellRange = `${parsedActiveAddress.address}:${parsedActiveAddress.address}`;
    onAiSelectionChange({
      kind: 'workbook',
      target:
        normalizedRange !== singleCellRange &&
        /^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}:\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/.test(
          normalizedRange
        )
          ? { type: 'cell_range', sheetId: sheet.id, range: normalizedRange }
          : {
              type: 'cell',
              sheetId: sheet.id,
              address: parsedActiveAddress.address,
            },
    });
  }, [
    onAiSelectionChange,
    onCommentAnchorChange,
    parsedActiveAddress,
    range,
    revision.id,
    sheet,
  ]);

  useEffect(() => {
    if (sheet && sheet.id !== activeSheetId) setActiveSheetId(sheet.id);
  }, [activeSheetId, sheet]);

  const bounds = useMemo(() => {
    let maxRow = 0;
    let maxColumn = 0;
    for (const cell of sheet?.cells ?? []) {
      const address = parseCellAddress(cell.address);
      maxRow = Math.max(maxRow, address.row);
      maxColumn = Math.max(maxColumn, address.column);
    }
    return {
      rows: Math.min(Math.max(maxRow + 12, 32), 200),
      columns: Math.min(Math.max(maxColumn + 4, 12), 52),
    };
  }, [sheet]);

  const layout = useMemo(() => worksheetLayout(sheet, bounds), [sheet, bounds]);
  const activeDimensions =
    sheet && parsedActiveAddress
      ? worksheetDimensions(
          sheet,
          parsedActiveAddress.row,
          parsedActiveAddress.column
        )
      : undefined;

  const commandBase = useCallback(() => {
    const id = nanoid();
    return {
      version: 'localmind-office-command/v1' as const,
      commandId: id,
      idempotencyKey: `office-user:${id}`,
      artifactId,
      expectedRevisionId: revision.id,
      source: 'user' as const,
    };
  }, [artifactId, revision.id]);

  const runCommand = useCallback(
    async (command: OfficeCommand | OfficeCommandBatch, message: string) => {
      if (readOnly || savingRef.current) return false;
      if (pendingPaste.current && command !== pendingPaste.current.batch) {
        setError(i18n['com.affine.office.clipboard-pending']());
        return false;
      }
      savingRef.current = true;
      setSaving(true);
      setError(null);
      setStatus(
        command.version === 'localmind-office-command-batch/v1'
          ? i18n['com.affine.localmind.project-files.saving']()
          : I18n['com.affine.office.previewing-operation']({
              operation: message,
            })
      );
      try {
        const result = await executeAndReloadOfficeCommand<XlsxSemanticState>({
          graphql,
          owner,
          kind: 'workbook',
          command,
        });
        onRevision(result.revision, result.state);
        setStatus(
          I18n['com.affine.office.operation-saved']({
            operation: message,
            version: String(result.revision.sequence),
          }),
          result.revision.id
        );
        return true;
      } catch (err) {
        setError(officeErrorMessage(err, owner));
        setStatus(i18n['com.affine.office.save-failed']());
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [graphql, onRevision, owner, readOnly, i18n, setStatus]
  );

  const savePaste = useCallback(async () => {
    const pending = pendingPaste.current;
    if (!pending) return false;
    const saved = await runCommand(pending.batch, pending.range);
    if (saved) {
      pendingPaste.current = null;
      setHasPendingPaste(false);
      setRange(pending.range);
    }
    return saved;
  }, [runCommand]);

  const clipboardError = (caught: unknown) => {
    const code =
      caught instanceof SpreadsheetClipboardError ? caught.code : 'invalid';
    const messages = {
      limit: i18n['com.affine.office.clipboard-limit'](),
      shape: i18n['com.affine.office.clipboard-shape'](),
      merged: i18n['com.affine.office.clipboard-merged'](),
      invalid: i18n['com.affine.office.clipboard-invalid'](),
    };
    setError(messages[code]);
  };

  const save = useCallback(async () => {
    if (!sheet || readOnly || saving) return false;
    if (pendingPaste.current) return savePaste();
    if (!parsedActiveAddress) {
      setError(
        i18n['com.affine.office.enter-a-valid-cell-address-for-example-a1']()
      );
      setStatus(i18n['com.affine.office.invalid-cell-address']());
      return false;
    }
    const input = parseSpreadsheetInput(draft);
    if (input.type !== 'formula') {
      const validation = validateXlsxCellValue(
        state,
        sheet,
        parsedActiveAddress.address,
        input.type === 'blank' ? null : input.value
      );
      if (validation) {
        setError(
          i18n[
            validation === 'invalid'
              ? 'com.affine.office.validation-invalid'
              : 'com.affine.office.validation-unsupported'
          ]()
        );
        setStatus(i18n['com.affine.office.save-failed']());
        return false;
      }
    }
    if (input.type === 'formula') {
      try {
        // This preview improves feedback; the command engine recalculates and
        // checks persisted rules again before producing a revision.
        const value = evaluateXlsxFormula(parseXlsxFormula(input.formula), {
          sheet: sheet.name,
          resolveCell: (sheetName, address) => {
            const cell = state.sheets
              .find(item => item.name === sheetName)
              ?.cells.find(item => item.address === address);
            return (cell?.formula ? cell.calculatedValue : cell?.value) ?? null;
          },
        });
        const validation = Array.isArray(value)
          ? 'invalid'
          : validateXlsxCellValue(
              state,
              sheet,
              parsedActiveAddress.address,
              value
            );
        if (validation) {
          setError(
            i18n[
              validation === 'invalid'
                ? 'com.affine.office.validation-invalid'
                : 'com.affine.office.validation-unsupported'
            ]()
          );
          setStatus(i18n['com.affine.office.save-failed']());
          return false;
        }
      } catch (err) {
        setError(formulaErrorMessage(err instanceof Error ? err.message : ''));
        setStatus(i18n['com.affine.office.save-failed']());
        return false;
      }
    }
    const command = {
      ...commandBase(),
      operation: 'office.workbook.cell.set',
      target: {
        type: 'cell',
        sheetId: sheet.id,
        address: parsedActiveAddress.address,
      },
      input,
      styleIndex: activeCell?.styleIndex,
    } satisfies OfficeWorkbookSetCellCommand;
    const saved = await runCommand(command, parsedActiveAddress.address);
    if (saved) savedDraft.current = draft;
    return saved;
  }, [
    activeCell?.styleIndex,
    commandBase,
    draft,
    parsedActiveAddress,
    state,
    readOnly,
    runCommand,
    saving,
    savePaste,
    sheet,
    setStatus,

    i18n,
  ]);

  useOfficeEditorDraft(registerDraft, {
    get hasUnsavedChanges() {
      return (
        Boolean(pendingPaste.current) ||
        currentDraft.current !== savedDraft.current
      );
    },
    save: async () => {
      if (!(await save()))
        throw new Error(
          i18n['com.affine.office.office-draft-could-not-be-saved']()
        );
    },
    discard: async () => {
      pendingPaste.current = null;
      setHasPendingPaste(false);
      setError(null);
      setStatus(i18n['com.affine.office.ready']());
      currentDraft.current = savedDraft.current;
      setDraft(savedDraft.current);
    },
  });

  const applyFormat = useCallback(async () => {
    if (!sheet) return;
    await runCommand(
      {
        ...commandBase(),
        operation: 'office.workbook.range.format',
        target: { type: 'cell_range', sheetId: sheet.id, range },
        format: {
          fontFamily,
          fontSizePt: fontSize,
          bold,
          italic,
          underline,
          textColor,
          fillColor,
          horizontalAlignment: alignment,
          wrapText,
          numberFormatId,
        },
      },
      i18n['com.affine.office.range-formatting']()
    );
  }, [
    alignment,
    bold,
    commandBase,
    fillColor,
    fontFamily,
    fontSize,
    italic,
    range,
    runCommand,
    sheet,
    textColor,
    underline,
    wrapText,
    numberFormatId,

    i18n,
  ]);

  const changeDimension = useCallback(
    async (axis: 'row' | 'column', action: 'insert' | 'delete') => {
      if (!sheet) return;
      if (!parsedActiveAddress) {
        setError(
          i18n[
            'com.affine.office.enter-a-valid-cell-address-before-changing-rows-or-columns'
          ]()
        );
        setStatus(i18n['com.affine.office.invalid-cell-address']());
        return;
      }
      await runCommand(
        {
          ...commandBase(),
          operation: 'office.workbook.dimension.change',
          sheetId: sheet.id,
          axis,
          action,
          index:
            axis === 'row'
              ? parsedActiveAddress.row
              : parsedActiveAddress.column,
          count: dimensionCount,
        },
        `${action === 'insert' ? 'Insert' : 'Delete'} ${axis}`
      );
    },
    [
      commandBase,
      dimensionCount,
      parsedActiveAddress,
      runCommand,
      sheet,
      i18n,
      setStatus,
    ]
  );

  const moveSheet = useCallback(
    async (direction: -1 | 1) => {
      if (!sheet) return;
      const order = state.sheets.map(candidate => candidate.id);
      const index = order.indexOf(sheet.id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target], order[index]];
      await runCommand(
        {
          ...commandBase(),
          operation: 'office.workbook.sheets.reorder',
          sheetIds: order,
        },
        i18n['com.affine.office.worksheet-order']()
      );
    },
    [commandBase, runCommand, sheet, state.sheets, i18n]
  );

  if (!sheet) {
    return (
      <div className={styles.editor}>
        <div className={styles.emptyState} role="status">
          {i18n['com.affine.office.this-workbook-has-no-worksheets']()}{' '}
        </div>
      </div>
    );
  }

  const selectedChart = sheet.charts.find(
    chart => chart.id === selectedChartId
  );
  return (
    <div className={styles.workbookEditor}>
      {selectedChart ? (
        <SpreadsheetChart
          state={state}
          sheet={sheet}
          chart={selectedChart}
          onClose={() => setSelectedChartId(null)}
        />
      ) : null}
      <div
        className={styles.toolbar}
        role="toolbar"
        aria-label={i18n['com.affine.office.spreadsheet-editing']()}
      >
        <input
          className={styles.compactInput}
          value={activeAddress}
          aria-label={i18n['com.affine.office.active-cell-address']()}
          onChange={event => {
            const value = event.target.value.toUpperCase();
            changeSelection(() => setActiveAddress(value));
          }}
          onBlur={() => {
            if (parsedActiveAddress) {
              changeSelection(() =>
                setActiveAddress(parsedActiveAddress.address)
              );
            } else {
              changeSelection(() => setActiveAddress('A1'));
              setError(
                i18n['com.affine.office.cell-address-was-reset-to-a1']()
              );
              setStatus(i18n['com.affine.office.invalid-cell-address']());
            }
          }}
        />
        <input
          className={styles.formulaInput}
          value={draft}
          disabled={readOnly || saving || hasPendingPaste}
          ref={formulaInputRef}
          data-created-resource-focus-target
          aria-label={i18n['com.affine.office.cell-value-or-formula']()}
          placeholder={i18n[
            'com.affine.office.enter-a-value-or-start-a-formula-with'
          ]()}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (
              event.key === 'Enter' &&
              !isComposingKeyboardEvent(event) &&
              !event.repeat
            ) {
              event.preventDefault();
              save().catch(console.error);
            }
          }}
        />
        <Button
          variant="primary"
          disabled={readOnly}
          loading={saving}
          onClick={() => {
            save().catch(console.error);
          }}
        >
          {i18n['com.affine.office.save-cell']()}{' '}
        </Button>
        <input
          className={styles.compactRangeInput}
          value={range}
          aria-label={i18n['com.affine.office.selected-cell-range']()}
          onChange={event => setRange(event.target.value.toUpperCase())}
        />
        <IconButton
          size="24"
          tooltip={i18n['com.affine.keyboardShortcuts.bold']()}
          aria-label={i18n['com.affine.keyboardShortcuts.bold']()}
          data-active={bold}
          disabled={readOnly || saving}
          onClick={() => setBold(value => !value)}
        >
          <BoldIcon />
        </IconButton>
        <IconButton
          size="24"
          tooltip={i18n['com.affine.keyboardShortcuts.italic']()}
          aria-label={i18n['com.affine.keyboardShortcuts.italic']()}
          data-active={italic}
          disabled={readOnly || saving}
          onClick={() => setItalic(value => !value)}
        >
          <ItalicIcon />
        </IconButton>
        <IconButton
          size="24"
          tooltip={i18n['com.affine.office.annotation-type.underline']()}
          aria-label={i18n['com.affine.keyboardShortcuts.underline']()}
          data-active={underline}
          disabled={readOnly || saving}
          onClick={() => setUnderline(value => !value)}
        >
          <span className={styles.underlineIcon}>U</span>
        </IconButton>
        <Button
          disabled={readOnly}
          loading={saving}
          onClick={() => void applyFormat()}
        >
          {i18n['com.affine.office.apply-format']()}{' '}
        </Button>
      </div>
      <div className={styles.toolbar}>
        <span>{i18n['com.affine.office.clipboard-help']()}</span>
        {hasPendingPaste ? (
          <>
            <span role="status">
              {i18n['com.affine.office.clipboard-pending']()}
            </span>
            <Button
              disabled={readOnly || saving}
              onClick={() => void savePaste()}
            >
              {i18n['com.affine.office.clipboard-retry']()}
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                pendingPaste.current = null;
                setHasPendingPaste(false);
                setError(null);
                setStatus(i18n['com.affine.office.ready']());
              }}
            >
              {i18n['com.affine.office.clipboard-discard']()}
            </Button>
          </>
        ) : null}
      </div>
      <div className={styles.sheetsBody}>
        <div className={styles.sheetWorkspace}>
          <div
            className={styles.gridScroller}
            role="region"
            aria-label={I18n['com.affine.office.named-worksheet']({
              name: sheet.name,
            })}
          >
            <div
              className={styles.sheetGrid}
              role="grid"
              onCopy={event => {
                event.preventDefault();
                try {
                  event.clipboardData.setData(
                    'text/plain',
                    copySpreadsheetValues(sheet, range)
                  );
                  setError(null);
                  setStatus(i18n['com.affine.office.clipboard-copied']());
                } catch (caught) {
                  clipboardError(caught);
                }
              }}
              onPaste={event => {
                event.preventDefault();
                if (readOnly) {
                  setError(i18n['com.affine.office.clipboard-readonly']());
                  return;
                }
                if (
                  savingRef.current ||
                  pendingPaste.current ||
                  currentDraft.current !== savedDraft.current
                ) {
                  setError(i18n['com.affine.office.clipboard-pending']());
                  return;
                }
                try {
                  if (!event.clipboardData.types.includes('text/plain'))
                    throw new SpreadsheetClipboardError('invalid');
                  pendingPaste.current = spreadsheetPasteBatch({
                    text: event.clipboardData.getData('text/plain'),
                    address: activeAddress,
                    sheet,
                    artifactId,
                    revisionId: revision.id,
                    id: nanoid(),
                  });
                  setHasPendingPaste(true);
                  savePaste().catch(clipboardError);
                } catch (caught) {
                  clipboardError(caught);
                }
              }}
              aria-rowcount={bounds.rows}
              aria-colcount={bounds.columns}
              style={{
                gridTemplateColumns: layout.gridTemplateColumns,
                gridTemplateRows: layout.gridTemplateRows,
              }}
            >
              <div
                className={styles.cornerHeader}
                style={{ gridRow: 1, gridColumn: 1 }}
              />
              {layout.columns.map((column, index) => (
                <div
                  className={styles.columnHeader}
                  key={`column:${column}`}
                  style={{ gridRow: 1, gridColumn: index + 2 }}
                >
                  {columnIndexToName(column)}
                </div>
              ))}
              {layout.rows.map((row, rowIndex) => {
                return [
                  <div
                    className={styles.rowHeader}
                    key={`row:${row}`}
                    style={{ gridRow: rowIndex + 2, gridColumn: 1 }}
                  >
                    {row}
                  </div>,
                  ...layout.columns.map((column, columnIndex) => {
                    const position = `${columnIndexToName(column)}${row}`;
                    const merged = layout.merged.get(position);
                    if (merged === null) return null;
                    const address = merged?.address ?? position;
                    const cell = cells.get(address);
                    return (
                      <button
                        type="button"
                        role="gridcell"
                        aria-selected={address === parsedActiveAddress?.address}
                        aria-rowindex={row}
                        aria-colindex={column}
                        aria-rowspan={merged?.rowSpan}
                        aria-colspan={merged?.columnSpan}
                        aria-label={`${address}: ${cellDisplay(cell, state) || i18n['com.affine.office.empty-cell']()}`}
                        title={
                          cell?.formula && cell.calculationError
                            ? formulaErrorMessage(cell.calculationError)
                            : undefined
                        }
                        className={styles.sheetCell}
                        data-active={address === parsedActiveAddress?.address}
                        key={address}
                        style={{
                          ...cellStyle(state, cell),
                          gridRow: `${rowIndex + 2} / span ${merged?.rowSpan ?? 1}`,
                          gridColumn: `${columnIndex + 2} / span ${merged?.columnSpan ?? 1}`,
                        }}
                        onClick={() => {
                          if (address !== activeAddress)
                            changeSelection(() => setActiveAddress(address));
                        }}
                        onDoubleClick={() => {
                          changeSelection(() => {
                            setActiveAddress(address);
                            formulaInputRef.current?.focus();
                          });
                        }}
                      >
                        {cellDisplay(cell, state)}
                      </button>
                    );
                  }),
                ];
              })}
            </div>
          </div>
          <aside
            className={styles.sheetInspector}
            aria-label={i18n['com.affine.office.sheet-tools']()}
          >
            <fieldset
              className={styles.inspectorFieldset}
              disabled={readOnly || saving}
            >
              <div className={styles.panelTitle}>
                {i18n['com.affine.office.range-format']()}
              </div>
              <div className={styles.inspectorGroup}>
                <label className={styles.fieldLabel}>
                  {i18n['com.affine.office.number-format']()}
                  <select
                    className={styles.select}
                    aria-label={i18n['com.affine.office.number-format']()}
                    value={numberFormatId}
                    onChange={event =>
                      setNumberFormatId(Number(event.target.value))
                    }
                  >
                    {numberFormats.map(([id, code]) => (
                      <option key={id} value={id}>
                        {id === 0
                          ? i18n['com.affine.office.number-format-general']()
                          : code}
                      </option>
                    ))}
                    {!numberFormats.some(([id]) => id === numberFormatId) && (
                      <option value={numberFormatId}>
                        {i18n['com.affine.office.number-format-preserved']({
                          id: String(numberFormatId),
                        })}
                      </option>
                    )}
                  </select>
                </label>
                {!numberFormats.some(([id]) => id === numberFormatId) && (
                  <p>{i18n['com.affine.office.number-format-raw-preview']()}</p>
                )}
                <div className={styles.inspectorGrid}>
                  <label className={styles.fieldLabel}>
                    {i18n[
                      'com.affine.settings.editorSettings.edgeless.text.font'
                    ]()}{' '}
                    <input
                      className={styles.field}
                      value={fontFamily}
                      maxLength={256}
                      onChange={event => setFontFamily(event.target.value)}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {i18n['com.affine.office.size']()}{' '}
                    <input
                      className={styles.field}
                      type="number"
                      min={1}
                      max={400}
                      value={fontSize}
                      onChange={event =>
                        setFontSize(Number(event.target.value))
                      }
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {i18n['com.affine.settings.editorSettings.edgeless.text']()}{' '}
                    <input
                      className={styles.colorInput}
                      type="color"
                      value={textColor}
                      onChange={event => setTextColor(event.target.value)}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {i18n['com.affine.office.fill']()}{' '}
                    <input
                      className={styles.colorInput}
                      type="color"
                      value={fillColor}
                      onChange={event => setFillColor(event.target.value)}
                    />
                  </label>
                </div>
                <select
                  className={styles.select}
                  value={alignment}
                  aria-label={i18n['com.affine.office.horizontal-alignment']()}
                  onChange={event =>
                    setAlignment(event.target.value as typeof alignment)
                  }
                >
                  <option value="left">
                    {i18n[
                      'com.affine.settings.editorSettings.edgeless.text.alignment.left'
                    ]()}
                  </option>
                  <option value="center">
                    {i18n[
                      'com.affine.settings.editorSettings.edgeless.text.alignment.center'
                    ]()}
                  </option>
                  <option value="right">
                    {i18n[
                      'com.affine.settings.editorSettings.edgeless.text.alignment.right'
                    ]()}
                  </option>
                </select>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={wrapText}
                    onChange={event => setWrapText(event.target.checked)}
                  />
                  {i18n['com.affine.office.wrap-text']()}{' '}
                </label>
                <div className={styles.buttonRow}>
                  <Button
                    disabled={readOnly}
                    loading={saving}
                    onClick={() =>
                      void runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.cells.merge.set',
                          target: {
                            type: 'cell_range',
                            sheetId: sheet.id,
                            range,
                          },
                          merged: true,
                        },
                        i18n['com.affine.office.merge-cells']()
                      )
                    }
                  >
                    {i18n['com.affine.office.merge']()}{' '}
                  </Button>
                  <Button
                    disabled={readOnly}
                    loading={saving}
                    onClick={() =>
                      void runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.cells.merge.set',
                          target: {
                            type: 'cell_range',
                            sheetId: sheet.id,
                            range,
                          },
                          merged: false,
                        },
                        i18n['com.affine.office.unmerge-cells']()
                      )
                    }
                  >
                    {i18n['com.affine.office.unmerge']()}{' '}
                  </Button>
                </div>
              </div>

              <div className={styles.panelTitle}>
                {i18n['com.affine.office.rows-and-columns']()}
              </div>
              <div className={styles.inspectorGroup}>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    disabled={!parsedActiveAddress}
                    checked={activeDimensions?.row?.hidden ?? false}
                    onChange={event => {
                      if (!parsedActiveAddress) return;
                      runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.row.properties.set',
                          sheetId: sheet.id,
                          row: parsedActiveAddress.row,
                          hidden: event.target.checked,
                        },
                        i18n['com.affine.office.current-row-hidden']()
                      ).catch(console.error);
                    }}
                  />
                  {i18n['com.affine.office.current-row-hidden']()}
                </label>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    disabled={!parsedActiveAddress}
                    checked={activeDimensions?.column?.hidden ?? false}
                    onChange={event => {
                      if (!parsedActiveAddress) return;
                      runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.column.properties.set',
                          sheetId: sheet.id,
                          startColumn: parsedActiveAddress.column,
                          endColumn: parsedActiveAddress.column,
                          hidden: event.target.checked,
                        },
                        i18n['com.affine.office.current-column-hidden']()
                      ).catch(console.error);
                    }}
                  />
                  {i18n['com.affine.office.current-column-hidden']()}
                </label>
                <div className={styles.inspectorGrid}>
                  <label className={styles.fieldLabel}>
                    {i18n['com.affine.office.row-height']()}{' '}
                    <input
                      className={styles.field}
                      type="number"
                      min={1}
                      max={409}
                      value={rowHeight}
                      onChange={event =>
                        setRowHeight(Number(event.target.value))
                      }
                      onBlur={() => {
                        if (
                          !parsedActiveAddress ||
                          rowHeight ===
                            (worksheetDimensions(
                              sheet,
                              parsedActiveAddress.row,
                              parsedActiveAddress.column
                            ).row?.heightPt ?? DEFAULT_ROW_HEIGHT)
                        )
                          return;
                        runCommand(
                          {
                            ...commandBase(),
                            operation: 'office.workbook.row.properties.set',
                            sheetId: sheet.id,
                            row: parsedActiveAddress.row,
                            heightPt: rowHeight,
                          },
                          i18n['com.affine.office.row-height']()
                        ).catch(console.error);
                      }}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    {i18n['com.affine.office.column-width']()}{' '}
                    <input
                      className={styles.field}
                      type="number"
                      min={1}
                      max={255}
                      value={columnWidth}
                      onChange={event =>
                        setColumnWidth(Number(event.target.value))
                      }
                      onBlur={() => {
                        if (
                          !parsedActiveAddress ||
                          columnWidth ===
                            (worksheetDimensions(
                              sheet,
                              parsedActiveAddress.row,
                              parsedActiveAddress.column
                            ).column?.width ?? DEFAULT_COLUMN_WIDTH)
                        )
                          return;
                        runCommand(
                          {
                            ...commandBase(),
                            operation: 'office.workbook.column.properties.set',
                            sheetId: sheet.id,
                            startColumn: parsedActiveAddress.column,
                            endColumn: parsedActiveAddress.column,
                            width: columnWidth,
                          },
                          i18n['com.affine.office.column-width']()
                        ).catch(console.error);
                      }}
                    />
                  </label>
                </div>
                <label className={styles.fieldLabel}>
                  {i18n['com.affine.office.insert-or-delete-count']()}{' '}
                  <input
                    className={styles.field}
                    type="number"
                    min={1}
                    max={10_000}
                    value={dimensionCount}
                    onChange={event =>
                      setDimensionCount(Math.max(1, Number(event.target.value)))
                    }
                  />
                </label>
                <div className={styles.iconButtonRow}>
                  <IconButton
                    size="24"
                    tooltip={i18n['com.affine.office.insert-rows']()}
                    aria-label={i18n['com.affine.office.insert-rows']()}
                    disabled={readOnly || saving || !parsedActiveAddress}
                    onClick={() => void changeDimension('row', 'insert')}
                  >
                    <InsertAboveIcon />
                  </IconButton>
                  <IconButton
                    size="24"
                    tooltip={i18n['com.affine.office.delete-rows']()}
                    aria-label={i18n['com.affine.office.delete-rows']()}
                    disabled={readOnly || saving || !parsedActiveAddress}
                    onClick={() => void changeDimension('row', 'delete')}
                  >
                    <InsertBelowIcon />
                  </IconButton>
                  <IconButton
                    size="24"
                    tooltip={i18n['com.affine.office.insert-columns']()}
                    aria-label={i18n['com.affine.office.insert-columns']()}
                    disabled={readOnly || saving || !parsedActiveAddress}
                    onClick={() => void changeDimension('column', 'insert')}
                  >
                    <InsertLeftIcon />
                  </IconButton>
                  <IconButton
                    size="24"
                    tooltip={i18n['com.affine.office.delete-columns']()}
                    aria-label={i18n['com.affine.office.delete-columns']()}
                    disabled={readOnly || saving || !parsedActiveAddress}
                    onClick={() => void changeDimension('column', 'delete')}
                  >
                    <InsertRightIcon />
                  </IconButton>
                </div>
              </div>

              <div className={styles.panelTitle}>
                {i18n['com.affine.office.data-tools']()}
              </div>
              <div className={styles.inspectorGroup}>
                <input
                  className={styles.field}
                  value={filterValues}
                  aria-label={i18n['com.affine.office.filter-values']()}
                  placeholder={i18n[
                    'com.affine.office.filter-values-comma-separated'
                  ]()}
                  onChange={event => setFilterValues(event.target.value)}
                />
                <div className={styles.buttonRow}>
                  <Button
                    disabled={readOnly || !filterValues.trim()}
                    loading={saving}
                    onClick={() =>
                      void runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.filter.set',
                          target: {
                            type: 'cell_range',
                            sheetId: sheet.id,
                            range,
                          },
                          criteria: [
                            {
                              columnIndex: 0,
                              values: filterValues
                                .split(',')
                                .map(value => value.trim())
                                .filter(Boolean),
                            },
                          ],
                        },
                        'Filter'
                      )
                    }
                  >
                    <FilterIcon />
                    {i18n['com.affine.m.selector.confirm-default']()}{' '}
                  </Button>
                  <Button
                    disabled={readOnly}
                    loading={saving}
                    onClick={() =>
                      void runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.filter.set',
                          target: {
                            type: 'cell_range',
                            sheetId: sheet.id,
                            range,
                          },
                          criteria: [],
                        },
                        i18n['com.affine.office.clear-filter']()
                      )
                    }
                  >
                    {i18n['com.affine.office.clear']()}{' '}
                  </Button>
                </div>
                <input
                  className={styles.field}
                  value={validationValues}
                  aria-label={i18n[
                    'com.affine.office.validation-list-values'
                  ]()}
                  placeholder={i18n[
                    'com.affine.office.allowed-values-comma-separated'
                  ]()}
                  onChange={event => setValidationValues(event.target.value)}
                />
                <div className={styles.buttonRow}>
                  <Button
                    disabled={readOnly || !validationValues.trim()}
                    loading={saving}
                    onClick={() =>
                      void runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.validation.set',
                          target: {
                            type: 'cell_range',
                            sheetId: sheet.id,
                            range,
                          },
                          validation: {
                            type: 'list',
                            formula1: `"${validationValues.replaceAll('"', '""')}"`,
                            allowBlank: true,
                          },
                        },
                        i18n['com.affine.office.data-validation']()
                      )
                    }
                  >
                    {i18n['com.affine.office.set-validation']()}{' '}
                  </Button>
                  <Button
                    disabled={readOnly}
                    loading={saving}
                    onClick={() =>
                      void runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.validation.set',
                          target: {
                            type: 'cell_range',
                            sheetId: sheet.id,
                            range,
                          },
                          validation: false,
                        },
                        i18n['com.affine.office.clear-validation']()
                      )
                    }
                  >
                    {i18n['com.affine.office.clear']()}{' '}
                  </Button>
                </div>
              </div>

              <div className={styles.panelTitle}>
                {i18n['com.affine.office.table']()}
              </div>
              <div className={styles.inspectorGroup}>
                <input
                  className={styles.field}
                  value={tableName}
                  maxLength={255}
                  aria-label={i18n['com.affine.office.table-name-label']()}
                  onChange={event => setTableName(event.target.value)}
                />
                <div className={styles.buttonRow}>
                  <Button
                    disabled={readOnly || !tableName.trim()}
                    loading={saving}
                    onClick={() =>
                      void runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.table.set',
                          target: {
                            type: 'cell_range',
                            sheetId: sheet.id,
                            range,
                          },
                          table: {
                            name: tableName,
                            styleName: 'TableStyleMedium2',
                          },
                        },
                        'Table'
                      )
                    }
                  >
                    <TableIcon />
                    {i18n['com.affine.nameWorkspace.button.create']()}{' '}
                  </Button>
                  <Button
                    disabled={readOnly}
                    loading={saving}
                    onClick={() =>
                      void runCommand(
                        {
                          ...commandBase(),
                          operation: 'office.workbook.table.set',
                          target: {
                            type: 'cell_range',
                            sheetId: sheet.id,
                            range,
                          },
                          table: false,
                        },
                        i18n['com.affine.office.remove-table']()
                      )
                    }
                  >
                    {i18n[
                      'com.affine.share-menu.member-management.remove'
                    ]()}{' '}
                  </Button>
                </div>
              </div>

              <div className={styles.panelTitle}>
                {i18n['com.affine.office.chart']()}
              </div>
              <div className={styles.inspectorGroup}>
                <select
                  className={styles.select}
                  value={chartType}
                  aria-label={i18n['com.affine.office.chart-type']()}
                  onChange={event =>
                    setChartType(event.target.value as typeof chartType)
                  }
                >
                  <option value="column">
                    {i18n['com.affine.office.column']()}
                  </option>
                  <option value="bar">{i18n['com.affine.office.bar']()}</option>
                  <option value="line">
                    {i18n['com.affine.office.line']()}
                  </option>
                  <option value="pie">{i18n['com.affine.office.pie']()}</option>
                </select>
                <input
                  className={styles.field}
                  value={categoryRange}
                  aria-label={i18n['com.affine.office.chart-category-range']()}
                  onChange={event => setCategoryRange(event.target.value)}
                />
                <input
                  className={styles.field}
                  value={valueRange}
                  aria-label={i18n['com.affine.office.chart-value-range']()}
                  onChange={event => setValueRange(event.target.value)}
                />
                <Button
                  disabled={readOnly}
                  loading={saving}
                  onClick={() =>
                    void runCommand(
                      {
                        ...commandBase(),
                        operation: 'office.workbook.chart.add',
                        sheetId: sheet.id,
                        chartType,
                        title: I18n['com.affine.office.named-chart']({
                          name: sheet.name,
                        }),
                        categoryRange: sheetFormulaRange(
                          sheet.name,
                          categoryRange
                        ),
                        series: [
                          {
                            name: 'Series 1',
                            valueRange: sheetFormulaRange(
                              sheet.name,
                              valueRange
                            ),
                          },
                        ],
                        anchor: { fromCell: 'E2', toCell: 'L16' },
                      },
                      'Chart'
                    )
                  }
                >
                  <ChartPanelIcon />
                  {i18n['com.affine.office.add-chart']()}{' '}
                </Button>
              </div>
            </fieldset>
            {sheet.charts.map(chart => (
              <div className={styles.objectRow} key={chart.id}>
                <Button
                  variant="plain"
                  onClick={() => setSelectedChartId(chart.id)}
                >
                  {chart.title || i18n['com.affine.office.chart']()} ·{' '}
                  {chart.type === 'unknown'
                    ? chart.type
                    : i18n[`com.affine.office.${chart.type}`]()}
                </Button>
                <IconButton
                  size="24"
                  tooltip={i18n['com.affine.office.delete-chart']()}
                  aria-label={I18n['com.affine.office.delete-named-chart']({
                    name: chart.title || chart.type,
                  })}
                  disabled={readOnly || saving}
                  onClick={() =>
                    void runCommand(
                      {
                        ...commandBase(),
                        operation: 'office.workbook.chart.delete',
                        sheetId: sheet.id,
                        chartId: chart.id,
                      },
                      i18n['com.affine.office.chart-deletion']()
                    )
                  }
                >
                  <DeleteIcon />
                </IconButton>
              </div>
            ))}
          </aside>
        </div>
        <div
          className={styles.sheetTabs}
          role="tablist"
          aria-label={i18n['com.affine.office.worksheets']()}
        >
          {state.sheets.map(candidate => (
            <button
              type="button"
              role="tab"
              aria-selected={candidate.id === sheet.id}
              className={styles.sheetTab}
              data-active={candidate.id === sheet.id}
              key={candidate.id}
              onClick={() => {
                if (candidate.id !== activeSheetId)
                  changeSelection(() => {
                    setActiveSheetId(candidate.id);
                    setActiveAddress('A1');
                  });
              }}
            >
              {candidate.name}
            </button>
          ))}
          <input
            className={styles.sheetNameInput}
            value={sheetName}
            maxLength={31}
            aria-label={i18n['com.affine.office.current-worksheet-name']()}
            disabled={readOnly || saving}
            onChange={event => setSheetName(event.target.value)}
          />
          <Button
            disabled={readOnly || saving || !sheetName.trim()}
            onClick={() =>
              void runCommand(
                {
                  ...commandBase(),
                  operation: 'office.workbook.sheet.rename',
                  sheetId: sheet.id,
                  name: sheetName,
                },
                i18n['com.affine.office.worksheet-rename']()
              )
            }
          >
            {i18n['com.affine.m.explorer.doc.rename']()}{' '}
          </Button>
          <IconButton
            size="24"
            tooltip={i18n['com.affine.office.move-worksheet-left']()}
            aria-label={i18n['com.affine.office.move-worksheet-left']()}
            disabled={
              readOnly ||
              saving ||
              state.sheets.findIndex(item => item.id === sheet.id) === 0
            }
            onClick={() => void moveSheet(-1)}
          >
            <ArrowUpSmallIcon />
          </IconButton>
          <IconButton
            size="24"
            tooltip={i18n['com.affine.office.move-worksheet-right']()}
            aria-label={i18n['com.affine.office.move-worksheet-right']()}
            disabled={
              readOnly ||
              saving ||
              state.sheets.findIndex(item => item.id === sheet.id) ===
                state.sheets.length - 1
            }
            onClick={() => void moveSheet(1)}
          >
            <ArrowDownSmallIcon />
          </IconButton>
          <IconButton
            size="24"
            tooltip={i18n['com.affine.office.delete-worksheet']()}
            aria-label={i18n['com.affine.office.delete-worksheet']()}
            disabled={readOnly || saving || state.sheets.length === 1}
            onClick={() =>
              void runCommand(
                {
                  ...commandBase(),
                  operation: 'office.workbook.sheet.delete',
                  sheetId: sheet.id,
                },
                i18n['com.affine.office.worksheet-deletion']()
              )
            }
          >
            <DeleteIcon />
          </IconButton>
          <input
            className={styles.sheetNameInput}
            value={newSheetName}
            maxLength={31}
            aria-label={i18n['com.affine.office.new-worksheet-name']()}
            disabled={readOnly || saving}
            onChange={event => setNewSheetName(event.target.value)}
          />
          <IconButton
            size="24"
            tooltip={i18n['com.affine.office.add-worksheet']()}
            aria-label={i18n['com.affine.office.add-worksheet']()}
            disabled={readOnly || saving || !newSheetName.trim()}
            onClick={() =>
              void runCommand(
                {
                  ...commandBase(),
                  operation: 'office.workbook.sheet.add',
                  name: newSheetName,
                  afterSheetId: sheet.id,
                },
                i18n['com.affine.office.worksheet-insertion']()
              )
            }
          >
            <PlusIcon />
          </IconButton>
        </div>
      </div>
      <div className={styles.statusBar} role="status" aria-live="polite">
        <span>{sheet.name}</span>
        <span>
          {state.stats.cells} {i18n['com.affine.office.cells']()}
        </span>
        <span>
          {state.stats.formulas} {i18n['com.affine.office.formulas']()}
        </span>
        <span>
          {state.stats.tables} {i18n['com.affine.office.tables']()}
        </span>
        <span>
          {state.stats.charts} {i18n['com.affine.office.charts']()}
        </span>
        {readOnly ? (
          <span>{i18n['com.affine.share-menu.option.link.readonly']()}</span>
        ) : null}
        {activeCell?.formula && activeCell.calculationError ? (
          <span className={styles.statusError}>
            {activeCell.address}:{' '}
            {formulaErrorMessage(activeCell.calculationError)}
          </span>
        ) : null}
        {error ? (
          <span className={styles.statusError}>{error}</span>
        ) : (
          <span>
            {status?.revisionId === revision.id
              ? status.message
              : i18n['com.affine.office.ready']()}
          </span>
        )}
      </div>
    </div>
  );
}
