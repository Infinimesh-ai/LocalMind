import {
  findFirstElement,
  getAttribute,
  getElementChildren,
  type OrderedXmlNode,
  parseOrderedXml,
} from '../docx/xml';
import {
  type OoxmlOpcPackage,
  OoxmlPackageError,
  openOoxmlPackage,
} from '../ooxml';
import {
  PPTX_PRESENTATION_CONTENT_TYPE,
  type PptxShape,
  readPptxSemanticState,
} from '../pptx';
import { REPORT_LIMITS, type ReportTemplate } from './schema';

// Imported decks often have dozens of sample slides; keep a usable outline.
const IMPORTED_CHAPTER_LIMIT = Math.min(12, REPORT_LIMITS.chapters);
const PPTX_TEMPLATE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml';

export type ImportedTemplateImage = {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
};
export type ImportedReportTemplate = {
  name?: string;
  theme: Pick<
    ReportTemplate['theme'],
    'background' | 'foreground' | 'accent' | 'aspectRatio'
  >;
  chapters: {
    title: string;
    layout: ReportTemplate['chapters'][number]['layout'];
  }[];
  cover?: ImportedTemplateImage;
  background?: ImportedTemplateImage;
  preview?: ImportedTemplateImage;
};

function openPresentation(bytes: Uint8Array) {
  try {
    return openOoxmlPackage(bytes, {
      format: 'pptx',
      expectedMainContentType: PPTX_PRESENTATION_CONTENT_TYPE,
    });
  } catch (error) {
    if (!(error instanceof OoxmlPackageError)) throw error;
    // .potx differs only by its main content type.
    return openOoxmlPackage(bytes, {
      format: 'pptx',
      expectedMainContentType: PPTX_TEMPLATE_CONTENT_TYPE,
    });
  }
}

function image(
  pkg: OoxmlOpcPackage,
  part: string | undefined
): ImportedTemplateImage | undefined {
  if (!part) return;
  const bytes = pkg.readPart(part);
  const type = pkg.getContentType(part);
  if (!bytes?.length || bytes.length > 20 * 1024 * 1024) return;
  if (type === 'image/png') return { bytes, mimeType: 'image/png' };
  if (type === 'image/jpeg' || type === 'image/jpg')
    return { bytes, mimeType: 'image/jpeg' };
  return;
}

/** Image part of a `<p:bg><p:bgPr><a:blipFill>` background, if any. */
function backgroundPart(pkg: OoxmlOpcPackage, part: string | undefined) {
  if (!part || !pkg.hasPart(part)) return;
  const roots = parseOrderedXml(
    pkg.requirePart(part),
    part,
    pkg.limits.maxXmlPartBytes
  );
  const element = (node: OrderedXmlNode) =>
    Object.keys(node).find(key => key !== ':@' && key !== '#text');
  const root = roots.find(element);
  const path = ['cSld', 'bg', 'bgPr', 'blipFill', 'blip'];
  let nodes: OrderedXmlNode[] = root
    ? getElementChildren(root, element(root) ?? '')
    : [];
  let found: OrderedXmlNode | undefined;
  for (const name of path) {
    found = findFirstElement(nodes, name);
    if (!found) return;
    nodes = getElementChildren(found, name);
  }
  const id = found ? getAttribute(found, 'embed') : undefined;
  return pkg.getRelationships(part).find(relationship => relationship.id === id)
    ?.resolvedTarget;
}

/** A picture covering most of the slide is treated as its background art. */
function fullBleedPart(
  shapes: PptxShape[],
  size: { widthPt: number; heightPt: number }
) {
  const area = size.widthPt * size.heightPt;
  return shapes.find(
    shape =>
      shape.type === 'picture' &&
      shape.image &&
      (shape.geometry?.widthPt ?? 0) * (shape.geometry?.heightPt ?? 0) >=
        area * 0.8
  )?.image?.part;
}

function slideTitle(shapes: PptxShape[]) {
  const titled = shapes.find(shape =>
    ['title', 'ctrTitle'].includes(shape.placeholder?.type ?? '')
  );
  const text = (titled ?? shapes.find(shape => shape.text?.trim()))?.text;
  return text?.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function documentTitle(pkg: OoxmlOpcPackage) {
  const part = 'docProps/core.xml';
  if (!pkg.hasPart(part)) return;
  const nodes = parseOrderedXml(
    pkg.requirePart(part),
    part,
    pkg.limits.maxXmlPartBytes
  );
  const root = findFirstElement(nodes, 'coreProperties');
  const title = root
    ? findFirstElement(getElementChildren(root, 'coreProperties'), 'title')
    : undefined;
  const text = title
    ? getElementChildren(title, 'title')
        .map(node => (typeof node['#text'] === 'string' ? node['#text'] : ''))
        .join('')
        .trim()
    : '';
  return text || undefined;
}

/**
 * Reads the visual design and outline of a .pptx/.potx so it can become a
 * report template. Slide text content is not kept beyond slide titles.
 */
export function importReportTemplateFromPptx(
  bytes: Uint8Array
): ImportedReportTemplate {
  const pkg = openPresentation(bytes);
  const state = readPptxSemanticState(pkg);
  const size = state.slideSize;
  const ratio = size.widthPt / Math.max(1, size.heightPt);
  const master = state.masters[0];
  const colors = master?.themeColors ?? {};
  const slides = state.slides.filter(slide => !slide.hidden);
  const titles: string[] = [];
  const chapters: ImportedReportTemplate['chapters'] = [];
  for (const [index, slide] of slides.entries()) {
    const title = slideTitle(slide.shapes);
    if (!title || titles.includes(title)) continue;
    titles.push(title);
    const pictures = slide.shapes.filter(shape => shape.type === 'picture');
    chapters.push({
      title,
      layout:
        index === 0 ? 'cover' : pictures.length >= 2 ? 'gallery' : 'content',
    });
    if (chapters.length >= IMPORTED_CHAPTER_LIMIT) break;
  }
  const slideBackground = (slide: (typeof slides)[number]) =>
    backgroundPart(pkg, slide.part) ??
    fullBleedPart(slide.shapes, size) ??
    backgroundPart(pkg, slide.layoutPart);
  const masterBackground =
    backgroundPart(pkg, master?.part) ??
    fullBleedPart(master?.shapes ?? [], size);
  // Content slides share one backdrop in most decks; take the most common.
  const counts = new Map<string, number>();
  for (const slide of slides.slice(1)) {
    const part = slideBackground(slide);
    if (part) counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  const contentBackground =
    [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? masterBackground;
  const coverBackground =
    (slides[0] && slideBackground(slides[0])) ?? contentBackground;
  const thumbnail = pkg.rootRelationships.find(relationship =>
    relationship.type.endsWith('/thumbnail')
  )?.resolvedTarget;
  return {
    name: documentTitle(pkg),
    theme: {
      background: colors.lt1 ?? '#FFFFFF',
      foreground: colors.dk1 ?? '#202124',
      accent: colors.accent1 ?? '#315F8C',
      aspectRatio: Math.abs(ratio - 4 / 3) < 0.05 ? '4:3' : '16:9',
    },
    chapters,
    cover: image(pkg, coverBackground),
    background: image(pkg, contentBackground),
    preview: image(pkg, thumbnail),
  };
}
