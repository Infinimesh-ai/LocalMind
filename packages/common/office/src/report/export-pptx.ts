import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { createNativeFile } from '../create';
import {
  reportChapterLayouts,
  type ReportElement,
  type ReportLayout,
  reportSlideBackgroundAssetId,
} from './layout';
import { escapeReportXml as xml, type ReportRenderInput } from './render-types';

const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const presentation =
  'http://schemas.openxmlformats.org/presentationml/2006/main';
const chartNs = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const ns = `xmlns:p="${presentation}" xmlns:a="${drawing}" xmlns:r="${r}"`;
const relationship = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
const relations = (value: string) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${value}</Relationships>`;
const emu = (pt: number) => Math.round(pt * 12700);
const position = (
  element: { x: number; y: number; width: number; height: number },
  prefix = 'a'
) =>
  `<${prefix}:xfrm><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.width)}" cy="${emu(element.height)}"/></${prefix}:xfrm>`;
const shapeTree = (value: string) =>
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${value}</p:spTree>`;
const paragraphs = (text: string, size: number, color: string, bold = false) =>
  text
    .split('\n')
    .map(
      line =>
        `<a:p><a:pPr><a:lnSpc><a:spcPct val="145000"/></a:lnSpc></a:pPr><a:r><a:rPr lang="zh-CN" sz="${size * 100}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Noto Sans CJK SC"/><a:ea typeface="Noto Sans CJK SC"/></a:rPr><a:t>${xml(line)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${size * 100}"/></a:p>`
    )
    .join('');
function textShape(
  id: number,
  element: Extract<ReportElement, { type: 'text' }>,
  color: string
) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${position(element)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" tIns="0" bIns="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs(element.text, element.size, color, element.emphasis)}</p:txBody></p:sp>`;
}
const frame = (
  id: number,
  element: ReportElement,
  uri: string,
  contents: string
) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Object ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${position(element, 'p')}<a:graphic><a:graphicData uri="${uri}">${contents}</a:graphicData></a:graphic></p:graphicFrame>`;
function tableShape(
  id: number,
  element: Extract<ReportElement, { type: 'table' }>,
  color: string,
  accent: string
) {
  const rows = [element.columns, ...element.rows];
  const height = (cells: string[]) =>
    Math.max(...cells.map(cell => cell.split('\n').length)) * 20 + 14;
  return frame(
    id,
    element,
    'http://schemas.openxmlformats.org/drawingml/2006/table',
    `<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${element.columns.map(() => `<a:gridCol w="${emu(element.width / element.columns.length)}"/>`).join('')}</a:tblGrid>${rows.map((row, index) => `<a:tr h="${emu(height(row))}">${row.map(cell => `<a:tc><a:txBody><a:bodyPr lIns="${emu(8)}" rIns="${emu(8)}" tIns="${emu(7)}" bIns="${emu(7)}"/><a:lstStyle/>${paragraphs(cell, element.size, index ? color : 'FFFFFF', !index)}</a:txBody><a:tcPr>${!index ? `<a:solidFill><a:srgbClr val="${accent}"/></a:solidFill>` : ''}</a:tcPr></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl>`
  );
}
const column = (index: number) => String.fromCharCode(65 + index);
function chartXml(node: Extract<ReportElement, { type: 'chart' }>['node']) {
  const series = node.series
    .map((series, index) => {
      const reference = `'Data'!$${column(index + 1)}$2:$${column(index + 1)}$${node.labels.length + 1}`;
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef><c:f>'Data'!$${column(index + 1)}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${xml(series.label)}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>'Data'!$A$2:$A$${node.labels.length + 1}</c:f><c:strCache><c:ptCount val="${node.labels.length}"/>${node.labels.map((label, index) => `<c:pt idx="${index}"><c:v>${xml(label)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${reference}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${series.values.length}"/>${series.values.map((value, index) => (value === null ? '' : `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef></c:val></c:ser>`;
    })
    .join('');
  const circular = node.chartType === 'pie' || node.chartType === 'donut';
  const kind =
    node.chartType === 'line'
      ? 'lineChart'
      : node.chartType === 'pie'
        ? 'pieChart'
        : node.chartType === 'donut'
          ? 'doughnutChart'
          : 'barChart';
  const settings =
    kind === 'barChart'
      ? '<c:barDir val="col"/><c:grouping val="clustered"/>'
      : kind === 'lineChart'
        ? '<c:grouping val="standard"/>'
        : '<c:varyColors val="1"/>';
  const axes = `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx>`;
  return `<c:chartSpace xmlns:c="${chartNs}" xmlns:a="${drawing}" xmlns:r="${r}"><c:lang val="zh-CN"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>${paragraphs(node.title, 20, '202124')}</c:rich></c:tx></c:title><c:plotArea><c:layout/><c:${kind}>${settings}${series}${kind === 'doughnutChart' ? '<c:holeSize val="55"/>' : ''}${circular ? '' : '<c:axId val="1"/><c:axId val="2"/>'}</c:${kind}>${circular ? '' : axes}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:externalData r:id="data"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}

export function exportReportPptx(
  input: ReportRenderInput,
  layout: ReportLayout
) {
  const entries = unzipSync(
    createNativeFile({
      format: 'pptx',
      slides: layout.slides.map(slide => ({
        title: slide.title,
        paragraphs: [],
      })),
    }).bytes
  );
  const types: string[] = [];
  const set = (path: string, content: string, type?: string) => {
    entries[path] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`
    );
    if (type)
      types.push(`<Override PartName="/${path}" ContentType="${type}"/>`);
  };
  const color = input.projection.theme.foreground.slice(1),
    accent = input.projection.theme.accent.slice(1),
    background = input.projection.theme.background.slice(1);
  let mediaCount = 0,
    chartCount = 0;
  const assetRels = new Map<
    string,
    { path: string; width: number; height: number }
  >();
  for (const [id, asset] of input.assets) {
    const extension = asset.mimeType === 'image/png' ? 'png' : 'jpg';
    const path = `ppt/media/image${++mediaCount}.${extension}`;
    entries[path] = asset.bytes;
    types.push(
      `<Override PartName="/${path}" ContentType="${asset.mimeType}"/>`
    );
    assetRels.set(id, { path, width: 0, height: 0 });
  }
  set(
    'ppt/notesMasters/notesMaster1.xml',
    `<p:notesMaster ${ns}><p:cSld>${shapeTree('')}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/></p:notesMaster>`,
    'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml'
  );
  set(
    'ppt/notesMasters/_rels/notesMaster1.xml.rels',
    relations(relationship('theme', 'theme', '../theme/theme1.xml'))
  );
  const chapterLayouts = reportChapterLayouts(input.projection);
  layout.slides.forEach((slide, index) => {
    const relationships: string[] = [
      relationship('layout', 'slideLayout', '../slideLayouts/slideLayout1.xml'),
    ];
    const backgroundId = reportSlideBackgroundAssetId(
      input.projection.theme,
      chapterLayouts.get(slide.chapterId)
    );
    const elements: ReportElement[] = [
      ...(backgroundId
        ? [
            {
              type: 'image' as const,
              assetId: backgroundId,
              alt: '',
              x: 0,
              y: 0,
              width: layout.width,
              height: layout.height,
            },
          ]
        : []),
      {
        type: 'text',
        text: slide.title,
        size: 26,
        emphasis: true,
        x: 48,
        y: 28,
        width: layout.width - 144,
        height: 54,
      },
      ...slide.elements,
      {
        type: 'text',
        text: `${index + 1} / ${layout.slides.length}`,
        size: 12,
        x: layout.width - 96,
        y: layout.height - 28,
        width: 70,
        height: 18,
      },
    ];
    if (input.projection.theme.logoAssetId)
      elements.push({
        type: 'image',
        assetId: input.projection.theme.logoAssetId,
        alt: '',
        x: layout.width - 80,
        y: 24,
        width: 40,
        height: 40,
      });
    const shapes = elements
      .map((element, shapeIndex) => {
        const id = shapeIndex + 2;
        if (element.type === 'text')
          return textShape(id, element, element.emphasis ? accent : color);
        if (element.type === 'table')
          return tableShape(id, element, color, accent);
        if (element.type === 'image') {
          const asset = assetRels.get(element.assetId);
          if (!asset) throw new Error('REPORT_MISSING_ASSET');
          const rid = `rIdImage${id}`;
          relationships.push(
            relationship(
              rid,
              'image',
              `../media/${asset.path.split('/').pop()}`
            )
          );
          return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Image ${id}" descr="${xml(element.alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${position(element)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
        }
        const number = ++chartCount,
          rid = `chart${id}`;
        relationships.push(
          relationship(rid, 'chart', `../charts/chart${number}.xml`)
        );
        set(
          `ppt/charts/chart${number}.xml`,
          chartXml(element.node),
          'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
        );
        set(
          `ppt/charts/_rels/chart${number}.xml.rels`,
          relations(
            relationship('data', 'package', `../embeddings/data${number}.xlsx`)
          )
        );
        entries[`ppt/embeddings/data${number}.xlsx`] = createNativeFile({
          format: 'xlsx',
          sheets: [
            {
              name: 'Data',
              rows: [
                ['', ...element.node.series.map(series => series.label)],
                ...element.node.labels.map((label, index) => [
                  label,
                  ...element.node.series.map(series => series.values[index]),
                ]),
              ],
            },
          ],
        }).bytes;
        types.push(
          `<Override PartName="/ppt/embeddings/data${number}.xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>`
        );
        return frame(
          id,
          element,
          chartNs,
          `<c:chart xmlns:c="${chartNs}" r:id="${rid}"/>`
        );
      })
      .join('');
    if (slide.notes) {
      relationships.push(
        relationship(
          'notes',
          'notesSlide',
          `../notesSlides/notesSlide${index + 1}.xml`
        )
      );
      const body = textShape(
        2,
        {
          type: 'text',
          text: slide.notes,
          size: 14,
          x: 48,
          y: 60,
          width: 440,
          height: 620,
        },
        color
      ).replace('<p:nvPr/>', '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr>');
      set(
        `ppt/notesSlides/notesSlide${index + 1}.xml`,
        `<p:notes ${ns}><p:cSld>${shapeTree(body)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
        'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'
      );
      set(
        `ppt/notesSlides/_rels/notesSlide${index + 1}.xml.rels`,
        relations(
          relationship('slide', 'slide', `../slides/slide${index + 1}.xml`) +
            relationship(
              'master',
              'notesMaster',
              '../notesMasters/notesMaster1.xml'
            )
        )
      );
    }
    set(
      `ppt/slides/slide${index + 1}.xml`,
      `<p:sld ${ns}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${shapeTree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
    );
    set(
      `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      relations(relationships.join(''))
    );
  });
  let presentationXml = strFromU8(entries['ppt/presentation.xml']).replace(
    /<p:sldSz[^>]+\/>/,
    `<p:sldSz cx="${emu(layout.width)}" cy="${emu(layout.height)}"/>`
  );
  presentationXml = presentationXml.replace(
    '<p:sldIdLst>',
    '<p:notesMasterIdLst><p:notesMasterId r:id="notesMaster"/></p:notesMasterIdLst><p:sldIdLst>'
  );
  entries['ppt/presentation.xml'] = strToU8(presentationXml);
  entries['ppt/_rels/presentation.xml.rels'] = strToU8(
    strFromU8(entries['ppt/_rels/presentation.xml.rels']).replace(
      '</Relationships>',
      relationship(
        'notesMaster',
        'notesMaster',
        'notesMasters/notesMaster1.xml'
      ) + '</Relationships>'
    )
  );
  entries['[Content_Types].xml'] = strToU8(
    strFromU8(entries['[Content_Types].xml']).replace(
      '</Types>',
      types.join('') + '</Types>'
    )
  );
  return zipSync(entries, { level: 6, mtime: new Date(1980, 0, 1) });
}
