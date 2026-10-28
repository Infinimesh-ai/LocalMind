import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { createNativeFile } from '../create';
import { applyXlsxCommand } from './edit';
import { openXlsxPackage } from './package';

/** Reproduce the old writer's missing r binding and numbered styles path. */
export function createLegacyXlsxCompatibilityFixture() {
  let bytes = createNativeFile({
    format: 'xlsx',
    sheets: [
      {
        name: '预算',
        rows: [
          ['项目', '金额', '合计'],
          ['销售', 12, 0],
          ['成本', 3, 0],
        ],
      },
      {
        name: '汇总',
        rows: [
          ['项目', '金额'],
          ['销售', 12],
          ['成本', 3],
        ],
      },
    ],
  }).bytes;
  let index = 0;
  const command = (operation: string, input: Record<string, unknown>) => {
    bytes = applyXlsxCommand(openXlsxPackage(bytes), {
      version: 'localmind-office-command/v1',
      commandId: `fixture-${++index}`,
      idempotencyKey: `fixture-${index}`,
      artifactId: 'fixture',
      expectedRevisionId: 'fixture',
      source: 'user',
      operation,
      ...input,
    }).packageBytes;
  };
  for (const sheetId of ['1', '2']) {
    command('office.workbook.range.format', {
      target: { type: 'cell_range', sheetId, range: 'A1:B1' },
      format: { bold: true, fillColor: '#FFF2CC' },
    });
    if (sheetId === '1')
      command('office.workbook.table.set', {
        target: { type: 'cell_range', sheetId, range: 'A1:B3' },
        table: { name: `LegacyTable${sheetId}` },
      });
  }
  command('office.workbook.cell.set', {
    target: { type: 'cell', sheetId: '1', address: 'C2' },
    input: { type: 'formula', formula: 'SUM(B2:B3)' },
  });
  command('office.workbook.cell.set', {
    target: { type: 'cell', sheetId: '2', address: 'C2' },
    input: { type: 'formula', formula: "'预算'!C2" },
  });
  command('office.workbook.chart.add', {
    sheetId: '1',
    chartType: 'column',
    title: '收入与成本',
    categoryRange: '预算!$A$2:$A$3',
    series: [{ name: '金额', valueRange: '预算!$B$2:$B$3' }],
    anchor: { fromCell: 'E2', toCell: 'L16' },
  });
  const entries = unzipSync(bytes);
  entries['xl/tables/table2.xml'] = strToU8(
    '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="2" name="LegacyTable2" displayName="LegacyTable2" ref="A1:B3" totalsRowShown="0"><autoFilter ref="A1:B3"/><tableColumns count="2"><tableColumn id="1" name="项目"/><tableColumn id="2" name="金额"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>'
  );
  entries['xl/worksheets/_rels/sheet2.xml.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="legacyTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table2.xml"/></Relationships>'
  );
  entries['xl/worksheets/sheet2.xml'] = strToU8(
    strFromU8(entries['xl/worksheets/sheet2.xml']).replace(
      '</worksheet>',
      '<tableParts count="1"><tablePart r:id="legacyTable"/></tableParts></worksheet>'
    )
  );
  entries['[Content_Types].xml'] = strToU8(
    strFromU8(entries['[Content_Types].xml']).replace(
      '</Types>',
      '<Override PartName="/xl/tables/table2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>'
    )
  );
  for (const part of Object.keys(entries).filter(path =>
    /^xl\/worksheets\/[^/]+\.xml$/.test(path)
  ))
    entries[part] = strToU8(
      strFromU8(entries[part]).replace(
        / xmlns:r="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships"/g,
        ''
      )
    );
  entries['xl/styles1.xml'] = entries['xl/styles.xml'];
  delete entries['xl/styles.xml'];
  for (const part of ['[Content_Types].xml', 'xl/_rels/workbook.xml.rels'])
    entries[part] = strToU8(
      strFromU8(entries[part]).replaceAll('styles.xml', 'styles1.xml')
    );
  entries['[Content_Types].xml'] = strToU8(
    strFromU8(entries['[Content_Types].xml']).replace(
      '</Types>',
      '<Default Extension="bin" ContentType="application/octet-stream"/></Types>'
    )
  );
  entries['custom-preserved.bin'] = new Uint8Array([1, 7, 3, 9]);
  return zipSync(entries);
}
