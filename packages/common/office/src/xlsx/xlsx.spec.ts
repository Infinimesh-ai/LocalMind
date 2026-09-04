import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { applyXlsxCommand } from './edit';
import { evaluateXlsxFormula, parseXlsxFormula } from './formula';
import { openXlsxPackage, XLSX_WORKBOOK_CONTENT_TYPE } from './package';
import { readXlsxSemanticState } from './semantic';

function minimalXlsx(extras: Record<string, Uint8Array> = {}) {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(`
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Default Extension="bin" ContentType="application/octet-stream"/>
          <Override PartName="/xl/workbook.xml" ContentType="${XLSX_WORKBOOK_CONTENT_TYPE}"/>
          <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
          <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
          <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
        </Types>`),
      '_rels/.rels': strToU8(`
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
        </Relationships>`),
      'xl/workbook.xml': strToU8(`
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <bookViews><workbookView activeTab="0"/></bookViews>
          <sheets><sheet name="Budget" sheetId="7" r:id="sheet-rel"/></sheets>
          <definedNames><definedName name="Inputs">Budget!$A$2:$B$2</definedName></definedNames>
        </workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8(`
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="sheet-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
          <Relationship Id="strings-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
          <Relationship Id="styles-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
        </Relationships>`),
      'xl/sharedStrings.xml': strToU8(`
        <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1">
          <si><t>Revenue</t></si>
        </sst>`),
      'xl/styles.xml': strToU8(`
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="2">
            <font><sz val="11"/><name val="Aptos"/></font>
            <font><b/><color rgb="FF0000FF"/><sz val="14"/><name val="Arial"/></font>
          </fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>
          <borders count="1"><border/></borders>
          <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0"><alignment horizontal="center" wrapText="1"/></xf></cellXfs>
        </styleSheet>`),
      'xl/worksheets/sheet1.xml': strToU8(`
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <dimension ref="A1:C2"/>
          <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews>
          <cols><col min="1" max="1" width="18" customWidth="1"/></cols>
          <sheetData>
            <row r="1" ht="22"><c r="A1" t="s" s="1"><v>0</v></c></row>
            <row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>3</v></c><c r="C2"><f>SUM(A2:B2)</f><v>5</v></c></row>
          </sheetData>
          <mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>
        </worksheet>`),
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
  return applyXlsxCommand(openXlsxPackage(bytes), command);
}

describe('native XLSX engine', () => {
  test('reads workbook structure, sparse cells, styles, and formulas', () => {
    const state = readXlsxSemanticState(openXlsxPackage(minimalXlsx()));

    expect(state.sheets).toHaveLength(1);
    expect(state.sheets[0]).toMatchObject({
      id: '7',
      name: 'Budget',
      dimension: 'A1:C2',
      mergedCells: ['A1:B1'],
      frozenPane: { ySplit: 1, topLeftCell: 'A2' },
    });
    expect(
      state.sheets[0].cells.find(cell => cell.address === 'A1')
    ).toMatchObject({
      value: 'Revenue',
      styleIndex: 1,
    });
    expect(
      state.sheets[0].cells.find(cell => cell.address === 'C2')
    ).toMatchObject({
      formula: 'SUM(A2:B2)',
      calculatedValue: 5,
    });
    expect(state.styles.fonts[1]).toMatchObject({
      name: 'Arial',
      sizePt: 14,
      bold: true,
      color: '#0000FF',
    });
    expect(state.definedNames).toEqual([
      { name: 'Inputs', formula: 'Budget!$A$2:$B$2', localSheetId: undefined },
    ]);
  });

  test('sets a formula in a new sparse cell and preserves opaque parts', () => {
    const opaque = new Uint8Array([8, 6, 7, 5, 3, 0, 9]);
    const pkg = openXlsxPackage(minimalXlsx({ 'custom/opaque.bin': opaque }));
    const command = {
      version: 'localmind-office-command/v1',
      commandId: 'set-formula',
      idempotencyKey: 'set-formula',
      artifactId: 'artifact-1',
      expectedRevisionId: 'revision-1',
      source: 'ai',
      operation: 'office.workbook.cell.set',
      target: { type: 'cell', sheetId: '7', address: 'C3' },
      input: { type: 'formula', formula: '=A2*B2' },
      styleIndex: 1,
    } as const;

    const first = applyXlsxCommand(pkg, command);
    const second = applyXlsxCommand(pkg, command);
    expect(first.packageBytes).toEqual(second.packageBytes);
    expect(
      first.state.sheets[0].cells.find(cell => cell.address === 'C3')
    ).toMatchObject({
      formula: 'A2*B2',
      calculatedValue: 6,
      styleIndex: 1,
    });
    expect(
      openXlsxPackage(first.packageBytes).readPart('custom/opaque.bin')
    ).toEqual(opaque);
    expect(first.summary).toEqual({
      operation: 'office.workbook.cell.set',
      sheetId: '7',
      address: 'C3',
      valueType: 'formula',
      formulaLength: 6,
      stringLength: undefined,
      styleChanged: true,
    });
  });

  test('writes inline strings and rejects invalid targets or formulas', () => {
    const pkg = openXlsxPackage(minimalXlsx());
    const base = {
      version: 'localmind-office-command/v1',
      commandId: 'set-string',
      idempotencyKey: 'set-string',
      artifactId: 'artifact-1',
      expectedRevisionId: 'revision-1',
      source: 'user',
      operation: 'office.workbook.cell.set',
      target: { type: 'cell', sheetId: '7', address: 'D2' },
    } as const;
    const result = applyXlsxCommand(pkg, {
      ...base,
      input: { type: 'string', value: 'LocalMind native Sheets' },
    });
    expect(
      result.state.sheets[0].cells.find(cell => cell.address === 'D2')?.value
    ).toBe('LocalMind native Sheets');
    expect(() =>
      applyXlsxCommand(pkg, {
        ...base,
        target: { ...base.target, sheetId: 'missing' },
        input: { type: 'number', value: 1 },
      })
    ).toThrow(/sheet not found/);
    expect(() =>
      applyXlsxCommand(pkg, {
        ...base,
        input: { type: 'formula', formula: 'UNSUPPORTED(A1)' },
      })
    ).toThrow(/unsupported|invalid/i);
  });

  test('formats ranges and edits worksheet structure with round-trip state', () => {
    let bytes = minimalXlsx();
    let result = runCommand(
      bytes,
      officeCommand('office.workbook.range.format', {
        target: { type: 'cell_range', sheetId: '7', range: 'A2:B2' },
        format: {
          fontFamily: 'Arial',
          fontSizePt: 14,
          bold: true,
          italic: true,
          underline: true,
          textColor: '#0000FF',
          fillColor: '#FFF200',
          horizontalAlignment: 'center',
          wrapText: true,
        },
      })
    );
    bytes = result.packageBytes;
    const formatted = result.state.sheets[0].cells.find(
      cell => cell.address === 'A2'
    );
    const formattedStyle =
      result.state.styles.cells[formatted?.styleIndex ?? 0];
    expect(result.state.styles.fonts[formattedStyle.fontId ?? 0]).toMatchObject(
      {
        name: 'Arial',
        sizePt: 14,
        bold: true,
        italic: true,
        color: '#0000FF',
      }
    );
    expect(result.state.styles.fills[formattedStyle.fillId ?? 0]).toMatchObject(
      {
        foregroundColor: '#FFF200',
      }
    );

    result = runCommand(
      bytes,
      officeCommand('office.workbook.cells.merge.set', {
        target: { type: 'cell_range', sheetId: '7', range: 'A3:B3' },
        merged: true,
      })
    );
    bytes = result.packageBytes;
    expect(result.state.sheets[0].mergedCells).toContain('A3:B3');

    result = runCommand(
      bytes,
      officeCommand('office.workbook.row.properties.set', {
        sheetId: '7',
        row: 2,
        heightPt: 31,
        hidden: false,
      })
    );
    bytes = result.packageBytes;
    expect(
      result.state.sheets[0].rows.find(row => row.row === 2)
    ).toMatchObject({
      heightPt: 31,
      hidden: false,
    });

    result = runCommand(
      bytes,
      officeCommand('office.workbook.column.properties.set', {
        sheetId: '7',
        startColumn: 2,
        endColumn: 3,
        width: 24,
        hidden: true,
      })
    );
    bytes = result.packageBytes;
    expect(result.state.sheets[0].columns).toContainEqual({
      min: 2,
      max: 3,
      width: 24,
      hidden: true,
      styleIndex: undefined,
    });

    result = runCommand(
      bytes,
      officeCommand('office.workbook.filter.set', {
        target: { type: 'cell_range', sheetId: '7', range: 'A1:C2' },
        criteria: [{ columnIndex: 0, values: ['Revenue'] }],
      })
    );
    bytes = result.packageBytes;
    expect(result.state.sheets[0].autoFilter).toEqual({
      ref: 'A1:C2',
      criteria: [{ columnIndex: 0, values: ['Revenue'] }],
    });

    result = runCommand(
      bytes,
      officeCommand('office.workbook.validation.set', {
        target: { type: 'cell_range', sheetId: '7', range: 'D2:D4' },
        validation: {
          type: 'list',
          formula1: '"Open,Closed"',
          allowBlank: true,
          promptTitle: 'Status',
        },
      })
    );
    expect(result.state.sheets[0].dataValidations).toContainEqual(
      expect.objectContaining({
        range: 'D2:D4',
        type: 'list',
        formula1: '"Open,Closed"',
        allowBlank: true,
        promptTitle: 'Status',
      })
    );
  });

  test('adds, renames, reorders, edits, and deletes worksheets', () => {
    let result = runCommand(
      minimalXlsx(),
      officeCommand('office.workbook.sheet.add', {
        name: 'Forecast',
        afterSheetId: '7',
      })
    );
    let bytes = result.packageBytes;
    const added = result.state.sheets.find(sheet => sheet.name === 'Forecast');
    expect(added).toBeDefined();

    result = runCommand(
      bytes,
      officeCommand('office.workbook.sheet.rename', {
        sheetId: added?.id,
        name: 'Outlook',
      })
    );
    bytes = result.packageBytes;
    expect(result.state.sheets.map(sheet => sheet.name)).toEqual([
      'Budget',
      'Outlook',
    ]);

    result = runCommand(
      bytes,
      officeCommand('office.workbook.sheets.reorder', {
        sheetIds: [added?.id, '7'],
      })
    );
    bytes = result.packageBytes;
    expect(result.state.sheets.map(sheet => sheet.name)).toEqual([
      'Outlook',
      'Budget',
    ]);

    result = runCommand(
      bytes,
      officeCommand('office.workbook.dimension.change', {
        sheetId: '7',
        axis: 'row',
        action: 'insert',
        index: 2,
        count: 1,
      })
    );
    bytes = result.packageBytes;
    expect(
      result.state.sheets
        .find(sheet => sheet.id === '7')
        ?.cells.find(cell => cell.address === 'C3')
    ).toMatchObject({ formula: 'SUM(A3:B3)', calculatedValue: 5 });

    result = runCommand(
      bytes,
      officeCommand('office.workbook.dimension.change', {
        sheetId: '7',
        axis: 'row',
        action: 'delete',
        index: 2,
        count: 1,
      })
    );
    bytes = result.packageBytes;
    expect(
      result.state.sheets
        .find(sheet => sheet.id === '7')
        ?.cells.find(cell => cell.address === 'C2')
    ).toMatchObject({ formula: 'SUM(A2:B2)', calculatedValue: 5 });

    result = runCommand(
      bytes,
      officeCommand('office.workbook.sheet.delete', { sheetId: added?.id })
    );
    expect(result.state.sheets.map(sheet => sheet.name)).toEqual(['Budget']);
  });

  test('creates and removes native table and chart parts', () => {
    let result = runCommand(
      minimalXlsx(),
      officeCommand('office.workbook.table.set', {
        target: { type: 'cell_range', sheetId: '7', range: 'A1:C2' },
        table: {
          name: 'BudgetTable',
          styleName: 'TableStyleMedium4',
        },
      })
    );
    let bytes = result.packageBytes;
    expect(result.state.sheets[0].tables[0]).toMatchObject({
      name: 'BudgetTable',
      displayName: 'BudgetTable',
      ref: 'A1:C2',
      styleName: 'TableStyleMedium4',
      columns: [
        { id: '1', name: 'Revenue' },
        { id: '2', name: 'Column2' },
        { id: '3', name: 'Column3' },
      ],
    });

    result = runCommand(
      bytes,
      officeCommand('office.workbook.chart.add', {
        sheetId: '7',
        chartType: 'column',
        title: 'Budget chart',
        categoryRange: 'Budget!$A$2:$A$2',
        series: [{ name: 'Value', valueRange: 'Budget!$B$2:$B$2' }],
        anchor: { fromCell: 'E2', toCell: 'L16' },
      })
    );
    bytes = result.packageBytes;
    const chart = result.state.sheets[0].charts[0];
    expect(chart).toMatchObject({
      type: 'column',
      title: 'Budget chart',
      anchor: { fromCell: 'E2', toCell: 'L16' },
      series: [
        {
          name: 'Value',
          categoryFormula: 'Budget!$A$2:$A$2',
          valueFormula: 'Budget!$B$2:$B$2',
        },
      ],
    });

    result = runCommand(
      bytes,
      officeCommand('office.workbook.chart.delete', {
        sheetId: '7',
        chartId: chart.id,
      })
    );
    bytes = result.packageBytes;
    expect(result.state.sheets[0].charts).toEqual([]);

    result = runCommand(
      bytes,
      officeCommand('office.workbook.table.set', {
        target: { type: 'cell_range', sheetId: '7', range: 'A1:C2' },
        table: false,
      })
    );
    expect(result.state.sheets[0].tables).toEqual([]);
  });

  test('evaluates common logical, rounding, error, and conditional functions', () => {
    const values = new Map<string, number | string | boolean | null>([
      ['A1', 1],
      ['A2', 2],
      ['A3', 3],
      ['B1', 'Open'],
      ['B2', 'Closed'],
      ['B3', 'Open'],
    ]);
    const evaluate = (formula: string) =>
      evaluateXlsxFormula(parseXlsxFormula(formula), {
        sheet: 'Budget',
        resolveCell: (_sheet, address) => values.get(address) ?? null,
      });
    expect(evaluate('AND(A1<2,A2=2)')).toBe(true);
    expect(evaluate('OR(A1=0,NOT(FALSE))')).toBe(true);
    expect(evaluate('ROUND(1.236,2)')).toBe(1.24);
    expect(evaluate('ABS(-3)')).toBe(3);
    expect(evaluate('IFERROR(1/0,"fallback")')).toBe('fallback');
    expect(evaluate('COUNTA(B1:B3)')).toBe(3);
    expect(evaluate('COUNTIF(B1:B3,"Open")')).toBe(2);
    expect(evaluate('SUMIF(B1:B3,"Open",A1:A3)')).toBe(4);
  });
});
