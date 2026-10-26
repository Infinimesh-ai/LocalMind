import {
  type OfficeDocumentInsertObjectCommand,
  OfficeDocumentInsertObjectCommandSchema,
} from '../command';
import type { DocxOpcPackage } from './package';
import {
  getAttribute,
  getElementChildren,
  getTextContent,
  type OrderedXmlNode,
  parseOrderedXml,
} from './xml';

export type DocxEditableObject = Exclude<
  OfficeDocumentInsertObjectCommand['object'],
  { type: 'image' }
>;
export type DocxObjectData = {
  editableObject: boolean;
  objectData?: DocxEditableObject;
};

function children(node: OrderedXmlNode) {
  const key = Object.keys(node).find(key => key !== ':@' && key !== '#text');
  return key
    ? getElementChildren(node, key).filter(
        node => !('#text' in node) || String(node['#text']).trim()
      )
    : [];
}

function descendants(nodes: OrderedXmlNode[], name: string): OrderedXmlNode[] {
  const result: OrderedXmlNode[] = [];
  for (const node of nodes) {
    if (Array.isArray(node[name])) result.push(node);
    for (const child of descendants(children(node), name)) result.push(child);
  }
  return result;
}

function supportedTree(
  nodes: OrderedXmlNode[],
  allowed: Record<string, readonly string[]>
): boolean {
  return nodes.every(node => {
    const key = Object.keys(node).find(key => key !== ':@' && key !== '#text');
    if (!key) return true;
    if (!Object.hasOwn(allowed, key)) return false;
    const attrs = node[':@'];
    if (
      attrs &&
      typeof attrs === 'object' &&
      Object.keys(attrs).some(
        name => !name.startsWith('xmlns') && !allowed[key].includes(name)
      )
    )
      return false;
    return supportedTree(children(node), allowed);
  });
}

function text(node: OrderedXmlNode | undefined, name: string) {
  return node ? getTextContent(getElementChildren(node, name)) : '';
}

function checked(value: unknown, editableObject = true): DocxObjectData {
  const parsed =
    OfficeDocumentInsertObjectCommandSchema.shape.object.safeParse(value);
  return parsed.success && parsed.data.type !== 'image'
    ? { editableObject, objectData: parsed.data }
    : { editableObject: false };
}

function points(container: OrderedXmlNode | undefined) {
  if (!container) return null;
  const values = descendants(children(container), 'pt');
  if (!values.length || values.length > 200) return null;
  const ordered = values
    .map(point => ({
      index: Number(getAttribute(point, 'idx')),
      value: text(descendants(children(point), 'v')[0], 'v'),
    }))
    .sort((left, right) => left.index - right.index);
  if (ordered.some((point, index) => point.index !== index)) return null;
  return ordered.map(point => point.value);
}

export function readDocxChartData(
  pkg: DocxOpcPackage,
  part: string,
  widthPt: number | undefined,
  heightPt: number | undefined
): DocxObjectData {
  const bytes = pkg.readPart(part);
  if (!bytes) return { editableObject: false };
  const nodes = parseOrderedXml(bytes, part, pkg.limits.maxXmlPartBytes);
  const plot = descendants(nodes, 'plotArea')[0];
  if (!plot) return { editableObject: false };
  const chartNodes = children(plot).filter(node =>
    ['barChart', 'lineChart', 'pieChart'].some(name => name in node)
  );
  if (chartNodes.length !== 1) return { editableObject: false };
  const chart = chartNodes[0];
  const series = descendants(children(chart), 'ser');
  if (!series.length || series.length > 12) return { editableObject: false };
  const categories = points(descendants(children(series[0]), 'cat')[0]);
  if (!categories) return { editableObject: false };
  const parsedSeries = series.map(item => {
    const names = points(descendants(children(item), 'tx')[0]);
    const values = points(descendants(children(item), 'val')[0]);
    const itemCategories = points(descendants(children(item), 'cat')[0]);
    if (
      !values ||
      values.some(value => !value.trim() || !Number.isFinite(Number(value))) ||
      JSON.stringify(itemCategories) !== JSON.stringify(categories)
    )
      return null;
    return { name: names?.[0] || 'Series', values: values.map(Number) };
  });
  if (parsedSeries.some(item => item === null))
    return { editableObject: false };
  const chartType =
    'pieChart' in chart
      ? 'pie'
      : 'lineChart' in chart
        ? 'line'
        : getAttribute(
              descendants(children(chart), 'barDir')[0] ?? {},
              'val'
            ) === 'bar'
          ? 'bar'
          : 'column';
  const title = descendants(nodes, 'title')[0];
  const titleText = title
    ? descendants(children(title), 't')
        .map(node => text(node, 't'))
        .join('')
    : '';
  // Cached external data can be previewed but must not be replaced as literals.
  const unsupported = [
    'f',
    'externalData',
    'extLst',
    'spPr',
    'dLbls',
    'trendline',
    'errBars',
    'view3D',
    'manualLayout',
  ];
  const grouping = getAttribute(
    descendants(children(chart), 'grouping')[0] ?? {},
    'val'
  );
  const simpleTree = supportedTree(nodes, {
    chartSpace: [],
    date1904: ['val'],
    lang: ['val'],
    chart: [],
    title: [],
    tx: [],
    rich: [],
    bodyPr: [],
    lstStyle: [],
    p: [],
    r: [],
    rPr: ['lang'],
    t: [],
    plotArea: [],
    layout: [],
    barChart: [],
    lineChart: [],
    pieChart: [],
    barDir: ['val'],
    grouping: ['val'],
    varyColors: ['val'],
    ser: [],
    idx: ['val'],
    order: ['val'],
    strRef: [],
    strCache: [],
    ptCount: ['val'],
    pt: ['idx'],
    v: [],
    cat: [],
    strLit: [],
    val: [],
    numLit: [],
    formatCode: [],
    axId: ['val'],
    catAx: [],
    valAx: [],
    scaling: [],
    orientation: ['val'],
    delete: ['val'],
    axPos: ['val'],
    crossAx: ['val'],
    crosses: ['val'],
    plotVisOnly: ['val'],
  });
  const canonicalValues: Record<string, string[]> = {
    orientation: ['minMax'],
    delete: ['0'],
    crosses: ['autoZero'],
    formatCode: ['General'],
    date1904: ['0'],
    plotVisOnly: ['1'],
  };
  const canonical = Object.entries(canonicalValues).every(([name, values]) =>
    descendants(nodes, name).every(node =>
      values.includes(getAttribute(node, 'val') ?? text(node, name))
    )
  );
  const editable =
    simpleTree &&
    canonical &&
    !unsupported.some(name => descendants(nodes, name).length) &&
    (!grouping || grouping === 'clustered' || grouping === 'standard');
  return checked(
    {
      type: 'chart',
      chartType,
      title: titleText || undefined,
      categories,
      series: parsedSeries,
      widthPt: widthPt ?? 360,
      heightPt: heightPt ?? 240,
    },
    editable
  );
}

export function isEditableDocxChartContainer(node: OrderedXmlNode) {
  return (
    supportedTree([node], {
      drawing: [],
      inline: ['distT', 'distB', 'distL', 'distR'],
      extent: ['cx', 'cy'],
      effectExtent: ['l', 't', 'r', 'b'],
      docPr: ['id', 'name', 'descr'],
      cNvGraphicFramePr: [],
      graphicFrameLocks: ['noChangeAspect'],
      graphic: [],
      graphicData: ['uri'],
      chart: ['id'],
    }) &&
    descendants([node], 'inline').length === 1 &&
    descendants([node], 'docPr').every(node => !getAttribute(node, 'descr')) &&
    descendants([node], 'effectExtent').every(node =>
      ['l', 't', 'r', 'b'].every(key => getAttribute(node, key) === '0')
    )
  );
}

export function readDocxInlineObjectData(
  node: OrderedXmlNode,
  kind: string
): DocxObjectData {
  const nodes = children(node);
  if (kind === 'equation') {
    const runs = nodes.filter(item => 'r' in item);
    const simple =
      supportedTree([node], { oMath: [], r: [], t: ['space'] }) &&
      nodes.length === 1 &&
      runs.length === 1 &&
      children(runs[0]).length === 1 &&
      't' in children(runs[0])[0];
    if (!simple) return { editableObject: false };
    return checked({
      type: 'equation',
      linearText: text(children(runs[0])[0], 't'),
    });
  }
  if (kind !== 'shape') return { editableObject: false };
  const shape = nodes.find(item =>
    ['rect', 'roundrect', 'oval', 'line', 'shape'].some(name => name in item)
  );
  if (!shape || nodes.length !== 1) return { editableObject: false };
  const styles = new Map(
    (getAttribute(shape, 'style') ?? '').split(';').flatMap(part => {
      const split = part.indexOf(':');
      return split < 0
        ? []
        : [
            [
              part.slice(0, split).trim(),
              part.slice(split + 1).trim(),
            ] as const,
          ];
    })
  );
  const size = (name: string) => {
    const raw = styles.get(name);
    return raw && /^\d+(?:\.\d+)?pt$/.test(raw)
      ? Number(raw.slice(0, -2))
      : undefined;
  };
  const legacy = getAttribute(shape, 'type');
  const shapeType =
    'rect' in shape
      ? 'rectangle'
      : 'roundrect' in shape
        ? 'roundedRectangle'
        : 'oval' in shape
          ? 'ellipse'
          : 'line' in shape
            ? 'line'
            : legacy === '#_x0000_t202'
              ? getAttribute(shape, 'o') === 'ellipse'
                ? 'ellipse'
                : 'rectangle'
              : legacy === '#_x0000_t32'
                ? 'line'
                : undefined;
  if (!shapeType) return { editableObject: false };
  const body = descendants(children(shape), 'txbxContent')[0];
  const paragraphs = body ? descendants(children(body), 'p') : [];
  const shapeText = paragraphs
    .map(paragraph =>
      descendants(children(paragraph), 't')
        .map(item => text(item, 't'))
        .join('')
    )
    .join('\n');
  const editable =
    supportedTree([node], {
      pict: [],
      rect: ['id', 'style', 'fillcolor', 'strokecolor'],
      roundrect: ['id', 'style', 'fillcolor', 'strokecolor'],
      oval: ['id', 'style', 'fillcolor', 'strokecolor'],
      line: ['id', 'style', 'fillcolor', 'strokecolor'],
      shape: ['id', 'type', 'style', 'o', 'fillcolor', 'strokecolor'],
      textbox: [],
      txbxContent: [],
      p: [],
      r: [],
      t: ['space'],
    }) &&
    ![...styles.keys()].some(key => !['width', 'height'].includes(key)) &&
    !['fill', 'stroke', 'path', 'formulas', 'rPr', 'pPr'].some(
      name => descendants(children(shape), name).length
    ) &&
    paragraphs.length <= 1;
  return checked(
    {
      type: 'shape',
      shape: shapeType,
      widthPt: size('width'),
      heightPt: size('height'),
      text: shapeText || undefined,
      fillColor: getAttribute(shape, 'fillcolor'),
      lineColor: getAttribute(shape, 'strokecolor'),
    },
    editable
  );
}
