import { strToU8, zipSync } from 'fflate';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { PPTX_PRESENTATION_CONTENT_TYPE } from './pptx';
import { XLSX_WORKBOOK_CONTENT_TYPE } from './xlsx';

const RELATIONSHIPS_CONTENT_TYPE =
  'application/vnd.openxmlformats-package.relationships+xml';

function deterministicZip(entries: Record<string, Uint8Array>) {
  const mtime = new Date(1980, 0, 1, 0, 0, 0);
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, bytes]) => [
        path,
        [bytes, { level: 6, mtime }],
      ])
    ),
    { level: 6, mtime }
  );
}

export function createMinimalXlsxFixture(
  extras: Record<string, Uint8Array> = {}
) {
  return deterministicZip({
    '[Content_Types].xml': strToU8(`
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="${RELATIONSHIPS_CONTENT_TYPE}"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Default Extension="bin" ContentType="application/octet-stream"/>
        <Override PartName="/xl/workbook.xml" ContentType="${XLSX_WORKBOOK_CONTENT_TYPE}"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
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
      </workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="sheet-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="styles-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      </Relationships>`),
    'xl/styles.xml': strToU8(`
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts>
        <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
        <borders count="1"><border/></borders>
        <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs>
      </styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(`
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <dimension ref="A1:C2"/>
        <sheetData>
          <row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c></row>
          <row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>3</v></c><c r="C2"><f>SUM(A2:B2)</f><v>5</v></c></row>
        </sheetData>
      </worksheet>`),
    ...extras,
  });
}

function shapeTree(shape = '') {
  return `<p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    ${shape}
  </p:spTree>`;
}

export function createMinimalPptxFixture(
  extras: Record<string, Uint8Array> = {}
) {
  return deterministicZip({
    '[Content_Types].xml': strToU8(`
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="${RELATIONSHIPS_CONTENT_TYPE}"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Default Extension="bin" ContentType="application/octet-stream"/>
        <Override PartName="/ppt/presentation.xml" ContentType="${PPTX_PRESENTATION_CONTENT_TYPE}"/>
        <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
      </Types>`),
    '_rels/.rels': strToU8(`
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
      </Relationships>`),
    'ppt/presentation.xml': strToU8(`
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst><p:sldId id="256" r:id="slide-rel"/></p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
      </p:presentation>`),
    'ppt/_rels/presentation.xml.rels': strToU8(`
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="slide-rel" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      </Relationships>`),
    'ppt/slides/slide1.xml': strToU8(`
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld name="Opening">${shapeTree(`
          <p:sp>
            <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title" idx="0"/></p:nvPr></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2400" b="1"><a:latin typeface="Aptos Display"/></a:rPr><a:t>Hello LocalMind</a:t></a:r></a:p></p:txBody>
          </p:sp>`)}</p:cSld>
      </p:sld>`),
    ...extras,
  });
}

export async function createMinimalPdfFixture() {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.setTitle('LocalMind Native PDF');
  const first = document.addPage([612, 792]);
  document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  first.drawText('LocalMind native PDF', {
    x: 72,
    y: 720,
    font,
    size: 12,
  });
  const form = document.getForm();
  const field = form.createTextField('person.name');
  field.setText('Ada');
  field.addToPage(first, { x: 72, y: 650, width: 180, height: 24, font });
  return await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: true,
  });
}
