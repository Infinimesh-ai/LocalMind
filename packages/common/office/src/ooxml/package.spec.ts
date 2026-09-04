import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { openOoxmlPackage } from './package';

const WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

function minimalXlsx(
  extras: Record<string, Uint8Array> = {},
  relationships = `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`
) {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(`
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Default Extension="bin" ContentType="application/octet-stream"/>
          <Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_CONTENT_TYPE}"/>
        </Types>`),
      '_rels/.rels': strToU8(relationships),
      'xl/workbook.xml': strToU8(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'
      ),
      ...extras,
    },
    { level: 6 }
  );
}

describe('OOXML package', () => {
  test('opens a valid package and preserves unknown parts deterministically', () => {
    const opaque = new Uint8Array([0, 1, 2, 127, 255]);
    const pkg = openOoxmlPackage(minimalXlsx({ 'custom/opaque.bin': opaque }), {
      format: 'xlsx',
      expectedMainContentType: WORKBOOK_CONTENT_TYPE,
    });

    expect(pkg.mainPart).toBe('xl/workbook.xml');
    expect(pkg.readPart('custom/opaque.bin')).toEqual(opaque);
    const first = pkg.write();
    const second = pkg.write();
    expect(first).toEqual(second);
    const reopened = openOoxmlPackage(first, {
      format: 'xlsx',
      expectedMainContentType: WORKBOOK_CONTENT_TYPE,
    });
    expect(reopened.readPart('custom/opaque.bin')).toEqual(opaque);
  });

  test('rejects traversal, duplicate normalized paths, and unsafe XML', () => {
    expect(() =>
      openOoxmlPackage(minimalXlsx({ '../outside.bin': strToU8('x') }), {
        format: 'xlsx',
        expectedMainContentType: WORKBOOK_CONTENT_TYPE,
      })
    ).toThrow(/Invalid OPC part name/);

    expect(() =>
      openOoxmlPackage(
        minimalXlsx({ foo: strToU8('file'), 'foo/': strToU8('directory') }),
        {
          format: 'xlsx',
          expectedMainContentType: WORKBOOK_CONTENT_TYPE,
        }
      )
    ).toThrow(/repeats a path/);

    expect(() =>
      openOoxmlPackage(
        minimalXlsx(
          {},
          '<!DOCTYPE Relationships [<!ENTITY unsafe "x">]><Relationships>&unsafe;</Relationships>'
        ),
        {
          format: 'xlsx',
          expectedMainContentType: WORKBOOK_CONTENT_TYPE,
        }
      )
    ).toThrow(/declarations are not allowed/);
  });

  test('enforces package limits and main part identity', () => {
    expect(() =>
      openOoxmlPackage(minimalXlsx(), {
        format: 'xlsx',
        expectedMainContentType: WORKBOOK_CONTENT_TYPE,
        maxEntries: 2,
      })
    ).toThrow(/too many entries/);

    expect(() =>
      openOoxmlPackage(minimalXlsx(), {
        format: 'pptx',
        expectedMainContentType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
      })
    ).toThrow(/invalid main content type/);
  });
});
