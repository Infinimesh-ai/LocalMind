import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { expect, test } from 'vitest';

import { createNativeFile } from '../create';
import { exportXlsxCompatibilityCopy } from './compatibility';
import { createLegacyXlsxCompatibilityFixture } from './compatibility.fixture';
import { openXlsxPackage } from './package';
import { readXlsxSemanticState } from './semantic';

test('repairs every affected sheet without edits, preserving values, formulas, charts, styles and unrelated parts', () => {
  const original = createLegacyXlsxCompatibilityFixture();
  const unchanged = original.slice();
  const source = openXlsxPackage(original);
  const result = exportXlsxCompatibilityCopy(original);
  expect(result.changed).toBe(true);
  expect(original).toEqual(unchanged);
  const repaired = openXlsxPackage(result.bytes);
  const before = readXlsxSemanticState(source);
  expect(readXlsxSemanticState(repaired)).toMatchObject({
    sheets: before.sheets,
    styles: before.styles,
    definedNames: before.definedNames,
  });
  for (const part of source.listParts())
    if (!result.repairedParts.includes(part.path))
      expect(repaired.requirePart(part.path)).toEqual(
        source.requirePart(part.path)
      );
  expect(repaired.requirePart('xl/styles.xml')).toEqual(
    source.requirePart('xl/styles1.xml')
  );
  for (const sheet of ['sheet1', 'sheet2'])
    expect(
      strFromU8(repaired.requirePart(`xl/worksheets/${sheet}.xml`))
    ).toContain('xmlns:r=');
  expect(exportXlsxCompatibilityCopy(original).bytes).toEqual(result.bytes);
  expect(exportXlsxCompatibilityCopy(result.bytes)).toMatchObject({
    changed: false,
    bytes: result.bytes,
  });
});

test('healthy packages remain byte-for-byte identical', () => {
  const bytes = createNativeFile({
    format: 'xlsx',
    sheets: [{ name: 'Healthy', rows: [[1, 2]] }],
  }).bytes;
  expect(exportXlsxCompatibilityCopy(bytes)).toMatchObject({
    changed: false,
    bytes,
  });
});

test('local namespace bindings are retained and do not need root repairs', () => {
  const bytes = exportXlsxCompatibilityCopy(
    createLegacyXlsxCompatibilityFixture()
  ).bytes;
  const parts = unzipSync(bytes);
  const path = 'xl/worksheets/sheet2.xml';
  const namespace =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  parts[path] = strToU8(
    strFromU8(parts[path])
      .replace(` xmlns:r="${namespace}"`, '')
      .replace(/<tablePart\b/g, `<tablePart xmlns:r="${namespace}"`)
  );
  const source = zipSync(parts);
  expect(exportXlsxCompatibilityCopy(source)).toMatchObject({
    changed: false,
    bytes: source,
  });
});

test('ambiguous style collisions and signed repairs fail without changing the input', () => {
  const parts = unzipSync(createLegacyXlsxCompatibilityFixture());
  parts['xl/styles.xml'] = strToU8('<styleSheet/>');
  expect(() => exportXlsxCompatibilityCopy(zipSync(parts))).toThrow(
    'Conflicting'
  );
  delete parts['xl/styles.xml'];
  parts['_xmlsignatures/sig1.xml'] = strToU8('<Signature/>');
  expect(() => exportXlsxCompatibilityCopy(zipSync(parts))).toThrow('Signed');
});

test('package limits and invalid XML fail closed', () => {
  const bytes = createLegacyXlsxCompatibilityFixture();
  expect(() =>
    exportXlsxCompatibilityCopy(bytes, { maxPackageBytes: 10 })
  ).toThrow();
  const parts = unzipSync(bytes);
  parts['xl/worksheets/sheet2.xml'] = strToU8(
    '<!DOCTYPE worksheet><worksheet/>'
  );
  expect(() => exportXlsxCompatibilityCopy(zipSync(parts))).toThrow();
});
