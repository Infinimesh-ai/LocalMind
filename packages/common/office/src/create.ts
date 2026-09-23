import { strToU8, zipSync } from 'fflate';
import { z } from 'zod';

const validXmlText = (value: string) =>
  Array.from(value).every(character => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
    );
  });
const text = z
  .string()
  .max(64000)
  .refine(
    validXmlText,
    'Text contains characters that cannot be represented in XML'
  );
const cell = z.union([text, z.number().finite(), z.boolean(), z.null()]);

/** Bounded input, shared by AI tools and the deterministic package writer. */
export const NativeFileContentSchema = z.discriminatedUnion('format', [
  z
    .object({
      format: z.literal('docx'),
      paragraphs: z
        .array(
          z
            .object({
              text,
              heading: z.number().int().min(1).max(6).optional(),
            })
            .strict()
        )
        .min(1)
        .max(2000),
    })
    .strict(),
  z
    .object({
      format: z.literal('xlsx'),
      sheets: z
        .array(
          z
            .object({
              name: z
                .string()
                .min(1)
                .max(31)
                .refine(
                  value =>
                    validXmlText(value) &&
                    Array.from(value).every(
                      c => !"\\/[]:*?'".includes(c) && c.charCodeAt(0) >= 32
                    ),
                  'Invalid worksheet name'
                ),
              rows: z.array(z.array(cell).max(256)).max(10000),
            })
            .strict()
        )
        .min(1)
        .max(32),
    })
    .strict(),
  z
    .object({
      format: z.literal('pptx'),
      slides: z
        .array(
          z
            .object({
              title: text,
              paragraphs: z.array(text).max(20),
            })
            .strict()
        )
        .min(1)
        .max(100),
    })
    .strict(),
  z.object({ format: z.literal('txt'), text }).strict(),
  z.object({ format: z.literal('md'), text }).strict(),
  z.object({ format: z.literal('json'), text }).strict(),
  z
    .object({
      format: z.literal('csv'),
      rows: z.array(z.array(cell).max(256)).max(10000),
    })
    .strict(),
]);

export type NativeFileContent = z.infer<typeof NativeFileContentSchema>;
export const NATIVE_FILE_MAX_INPUT_BYTES = 1024 * 1024;

const relationships =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const rel =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const presentation =
  'http://schemas.openxmlformats.org/presentationml/2006/main';
const officeMime = 'application/vnd.openxmlformats-officedocument.';
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c] ?? c
  );
const relation = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${rel}/${type}" Target="${target}"/>`;
const rels = (content: string) =>
  `<Relationships xmlns="${relationships}">${content}</Relationships>`;

function packageBytes(
  root: string,
  entries: Record<string, string>,
  types: Record<string, string>
) {
  entries['_rels/.rels'] = rels(relation('root', 'officeDocument', root));
  entries['[Content_Types].xml'] =
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(
      types
    )
      .map(
        ([path, type]) =>
          `<Override PartName="/${path}" ContentType="${officeMime}${type}"/>`
      )
      .join('')}</Types>`;
  const mtime = new Date(1980, 0, 1);
  return zipSync(
    Object.fromEntries(
      Object.entries(entries)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, value]) => [
          path,
          [
            strToU8(
              `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`
            ),
            { mtime },
          ],
        ])
    ),
    { level: 6, mtime }
  );
}

function columnName(index: number): string {
  let result = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function shapeTree(shapes = '') {
  return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree>`;
}

function slideTheme() {
  const colors = {
    dk1: '202124',
    lt1: 'FFFFFF',
    dk2: '44546A',
    lt2: 'E7E6E6',
    accent1: '4472C4',
    accent2: 'ED7D31',
    accent3: 'A5A5A5',
    accent4: 'FFC000',
    accent5: '5B9BD5',
    accent6: '70AD47',
    hlink: '0563C1',
    folHlink: '954F72',
  };
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const fonts =
    '<a:latin typeface="Aptos"/><a:ea typeface="Noto Sans CJK SC"/><a:cs typeface="Arial"/>';
  return `<a:theme xmlns:a="${drawing}" name="LocalMind"><a:themeElements><a:clrScheme name="LocalMind">${Object.entries(
    colors
  )
    .map(
      ([name, color]) => `<a:${name}><a:srgbClr val="${color}"/></a:${name}>`
    )
    .join(
      ''
    )}</a:clrScheme><a:fontScheme name="LocalMind"><a:majorFont>${fonts}</a:majorFont><a:minorFont>${fonts}</a:minorFont></a:fontScheme><a:fmtScheme name="LocalMind"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map(width => `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr">${fill}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function textShape(
  id: number,
  name: string,
  lines: string[],
  y: number,
  height: number,
  size: number
) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="${y}"/><a:ext cx="10820400" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${lines.map(line => `<a:p><a:r><a:rPr lang="zh-CN" sz="${size}"><a:solidFill><a:srgbClr val="202124"/></a:solidFill><a:latin typeface="Aptos"/><a:ea typeface="Noto Sans CJK SC"/></a:rPr><a:t>${xml(line)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
}

export function createNativeFile(input: NativeFileContent) {
  if (strToU8(JSON.stringify(input)).length > NATIVE_FILE_MAX_INPUT_BYTES)
    throw new Error('Native file input exceeds 1 MiB');
  const content = NativeFileContentSchema.parse(input);
  if (content.format === 'docx') {
    const paragraphs = content.paragraphs
      .map(
        p =>
          `<w:p>${p.heading ? `<w:pPr><w:pStyle w:val="Heading${p.heading}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(p.text).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">')}</w:t></w:r></w:p>`
      )
      .join('');
    return {
      bytes: packageBytes(
        'word/document.xml',
        {
          'word/document.xml': `<w:document xmlns:w="${word}"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
          'word/_rels/document.xml.rels': rels(
            relation('styles', 'styles', 'styles.xml')
          ),
          'word/styles.xml': `<w:styles xmlns:w="${word}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:eastAsia="Noto Sans CJK SC"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${Array.from({ length: 6 }, (_, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${36 - i * 2}"/></w:rPr></w:style>`).join('')}</w:styles>`,
        },
        {
          'word/document.xml': 'wordprocessingml.document.main+xml',
          'word/styles.xml': 'wordprocessingml.styles+xml',
        }
      ),
      mimeType: `${officeMime}wordprocessingml.document`,
    };
  }
  if (content.format === 'xlsx') {
    if (
      new Set(content.sheets.map(s => s.name.toLowerCase())).size !==
      content.sheets.length
    )
      throw new Error('Worksheet names must be unique');
    const entries: Record<string, string> = {
      'xl/workbook.xml': `<workbook xmlns="${spreadsheet}" xmlns:r="${rel}"><sheets>${content.sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="s${i + 1}"/>`).join('')}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': rels(
        content.sheets
          .map((_, i) =>
            relation(`s${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`)
          )
          .join('')
      ),
    };
    const types: Record<string, string> = {
      'xl/workbook.xml': 'spreadsheetml.sheet.main+xml',
    };
    content.sheets.forEach((sheet, i) => {
      const path = `xl/worksheets/sheet${i + 1}.xml`;
      types[path] = 'spreadsheetml.worksheet+xml';
      entries[path] = `<worksheet xmlns="${spreadsheet}"><sheetData>${sheet.rows
        .map(
          (row, r) =>
            `<row r="${r + 1}">${row
              .map((value, c) => {
                const address = `${columnName(c)}${r + 1}`;
                if (value === null) return '';
                if (typeof value === 'string')
                  return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
                return `<c r="${address}"${typeof value === 'boolean' ? ' t="b"' : ''}><v>${typeof value === 'boolean' ? Number(value) : value}</v></c>`;
              })
              .join('')}</row>`
        )
        .join('')}</sheetData></worksheet>`;
    });
    return {
      bytes: packageBytes('xl/workbook.xml', entries, types),
      mimeType: `${officeMime}spreadsheetml.sheet`,
    };
  }
  if (content.format === 'pptx') {
    const ns = `xmlns:a="${drawing}" xmlns:r="${rel}" xmlns:p="${presentation}"`;
    const entries: Record<string, string> = {
      'ppt/presentation.xml': `<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="master"/></p:sldMasterIdLst><p:sldIdLst>${content.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="s${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
      'ppt/_rels/presentation.xml.rels': rels(
        relation('master', 'slideMaster', 'slideMasters/slideMaster1.xml') +
          content.slides
            .map((_, i) =>
              relation(`s${i + 1}`, 'slide', `slides/slide${i + 1}.xml`)
            )
            .join('')
      ),
      'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster ${ns}><p:cSld>${shapeTree()}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="layout"/></p:sldLayoutIdLst></p:sldMaster>`,
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels(
        relation('layout', 'slideLayout', '../slideLayouts/slideLayout1.xml') +
          relation('theme', 'theme', '../theme/theme1.xml')
      ),
      'ppt/theme/theme1.xml': slideTheme(),
      'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout ${ns} type="blank" preserve="1"><p:cSld name="Blank">${shapeTree()}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels(
        relation('master', 'slideMaster', '../slideMasters/slideMaster1.xml')
      ),
    };
    const types: Record<string, string> = {
      'ppt/presentation.xml': 'presentationml.presentation.main+xml',
      'ppt/slideMasters/slideMaster1.xml': 'presentationml.slideMaster+xml',
      'ppt/slideLayouts/slideLayout1.xml': 'presentationml.slideLayout+xml',
      'ppt/theme/theme1.xml': 'theme+xml',
    };
    content.slides.forEach((slide, i) => {
      const path = `ppt/slides/slide${i + 1}.xml`;
      types[path] = 'presentationml.slide+xml';
      entries[path] =
        `<p:sld ${ns}><p:cSld name="${xml(slide.title)}">${shapeTree(textShape(2, 'Title', [slide.title], 457200, 914400, 3200) + textShape(3, 'Body', slide.paragraphs, 1600200, 4572000, 2000))}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
      entries[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels(
        relation('layout', 'slideLayout', '../slideLayouts/slideLayout1.xml')
      );
    });
    return {
      bytes: packageBytes('ppt/presentation.xml', entries, types),
      mimeType: `${officeMime}presentationml.presentation`,
    };
  }
  if (content.format === 'csv') {
    const csv = content.rows
      .map(row =>
        row
          .map(value => `"${String(value ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\r\n');
    return { bytes: strToU8(csv), mimeType: 'text/csv' };
  }
  if (content.format === 'json') JSON.parse(content.text);
  return {
    bytes: strToU8(content.text),
    mimeType:
      content.format === 'json'
        ? 'application/json'
        : content.format === 'md'
          ? 'text/markdown'
          : 'text/plain',
  };
}
