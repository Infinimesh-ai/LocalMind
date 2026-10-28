import {
  degrees,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineWidth,
  setStrokingRgbColor,
  setTextRenderingMode,
  StandardFonts,
  TextRenderingMode,
} from 'pdf-lib';

import { createUnicodePdfFont } from '../pdf/font';
import type { DocxEditableObject } from './object-data';
import { docxObjectPreview } from './object-preview';
import { splitDocxParagraphPages } from './page-breaks';
import {
  docxPageGeometry,
  docxSectionNeedsPage,
  docxSectionNeedsParityPage,
  docxSectionRanges,
  docxSectionStory,
} from './sections';
import {
  type DocxBlock,
  type DocxParagraph,
  type DocxRunFormat,
  type DocxSection,
  type DocxSemanticState,
  type DocxTable,
} from './semantic';

export type DocxPdfExportOptions = {
  title?: string;
  author?: string;
  unicodeFont?: Uint8Array;
  fallbackFonts?: readonly Uint8Array[];
  readPart?: (partName: string) => Uint8Array | undefined;
};

export class DocxPdfFontError extends Error {
  constructor() {
    super(
      'PDF export cannot represent one or more document characters with the available fonts'
    );
    this.name = 'DocxPdfFontError';
  }
}

type PageLayout = {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type FontVariant = 'regular' | 'bold' | 'italic' | 'boldItalic';

function layoutForSection(section?: DocxSection): PageLayout {
  const geometry = docxPageGeometry(section);
  return {
    width: geometry.widthPt,
    height: geometry.heightPt,
    top: geometry.margins.topPt,
    right: geometry.margins.rightPt,
    bottom: geometry.margins.bottomPt,
    left: geometry.margins.leftPt,
  };
}

function collectParagraphs(
  blocks: readonly DocxBlock[],
  output: DocxParagraph[] = []
) {
  for (const block of blocks) {
    if (block.type === 'paragraph') output.push(block);
    else if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) collectParagraphs(cell.blocks, output);
      }
    } else if (block.type === 'contentControl') {
      collectParagraphs(block.blocks, output);
    }
  }
  return output;
}

function storyText(
  state: DocxSemanticState,
  sectionIndex: number,
  kind: 'header' | 'footer',
  firstPage: boolean
) {
  const story = docxSectionStory(state, sectionIndex, kind, firstPage);
  return story
    ? collectParagraphs(story.blocks)
        .map(item => item.text)
        .join(' ')
    : '';
}

function fontVariant(format: DocxRunFormat): FontVariant {
  if (format?.bold && format.italic) return 'boldItalic';
  if (format?.bold) return 'bold';
  if (format?.italic) return 'italic';
  return 'regular';
}

function fontSize(paragraph: DocxParagraph) {
  const explicit = paragraph.runs.find(run => run.format?.fontSizePt)?.format
    ?.fontSizePt;
  if (explicit) return Math.max(4, Math.min(72, explicit));
  const heading = /^Heading([1-6])$/i.exec(paragraph.properties?.styleId ?? '');
  const outline =
    paragraph.properties?.outlineLevel ??
    (heading ? Number(heading[1]) - 1 : undefined);
  return outline === 0 ? 18 : outline === 1 ? 14 : 11;
}

function colorComponents(value: string | undefined) {
  const normalized = value?.replace(/^#/, '');
  if (!normalized || !/^[0-9A-F]{6}$/i.test(normalized))
    return rgb(0.12, 0.14, 0.17);
  return rgb(
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255
  );
}

type PdfGlyph = {
  text: string;
  font: PDFFont;
  size: number;
  format: DocxRunFormat;
  width: number;
  syntheticBold: boolean;
  syntheticItalic: boolean;
};

function wrapGlyphs(glyphs: PdfGlyph[], width: (line: number) => number) {
  const lines: PdfGlyph[][] = [];
  let line: PdfGlyph[] = [];
  let lineWidth = 0;
  const flush = () => {
    lines.push(line);
    line = [];
    lineWidth = 0;
  };
  for (const glyph of glyphs) {
    if (glyph.text === '\n') {
      flush();
      continue;
    }
    if (line.length && lineWidth + glyph.width > width(lines.length)) {
      const breakAt = line.findLastIndex(item => item.text === ' ');
      if (breakAt > 0) {
        const carry = line.slice(breakAt + 1);
        line = line.slice(0, breakAt);
        flush();
        line = carry;
        lineWidth = carry.reduce((total, item) => total + item.width, 0);
      }
      if (line.length && lineWidth + glyph.width > width(lines.length)) flush();
    }
    line.push(glyph);
    lineWidth += glyph.width;
  }
  flush();
  return lines;
}

async function embedImage(
  document: PDFDocument,
  bytes: Uint8Array,
  contentType: string | undefined
): Promise<PDFImage | undefined> {
  try {
    if (contentType === 'image/png') return await document.embedPng(bytes);
    if (contentType === 'image/jpeg') return await document.embedJpg(bytes);
  } catch {
    return undefined;
  }
  return undefined;
}

export async function exportDocxStateToPdf(
  state: DocxSemanticState,
  options: DocxPdfExportOptions = {}
) {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.setTitle(options.title ?? 'LocalMind document');
  if (options.author) document.setAuthor(options.author);
  document.setProducer('LocalMind Native Docs');
  const fonts: Record<FontVariant, PDFFont> = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    italic: await document.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await document.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const unicode = options.unicodeFont
    ? await createUnicodePdfFont(document, options.unicodeFont)
    : undefined;
  const fallbacks = await Promise.all(
    (options.fallbackFonts ?? []).map(bytes =>
      createUnicodePdfFont(document, bytes)
    )
  );
  const supportedCharacters = new Map<PDFFont, Set<number>>();
  const supports = (font: PDFFont, character: string) => {
    let characters = supportedCharacters.get(font);
    if (!characters) {
      characters = new Set(font.getCharacterSet());
      supportedCharacters.set(font, characters);
    }
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && characters.has(codePoint);
  };
  const paragraphGlyphs = (
    paragraph: DocxParagraph,
    defaultSize = fontSize(paragraph)
  ) => {
    const glyphs: PdfGlyph[] = [];
    const styleChain: DocxRunFormat[] = [];
    const seen = new Set<string>();
    let styleId = paragraph.properties?.styleId;
    while (styleId && !seen.has(styleId) && seen.size < 32) {
      seen.add(styleId);
      const style = state.styles.find(item => item.styleId === styleId);
      if (!style) break;
      if (style.run) styleChain.unshift(style.run);
      styleId = style.basedOn;
    }
    const inherited = Object.assign({}, ...styleChain) as DocxRunFormat;
    for (const run of paragraph.runs) {
      if (run.change === 'deleted') continue;
      const format = { ...inherited, ...run.format };
      const size = Math.max(4, Math.min(72, format.fontSizePt ?? defaultSize));
      const text = run.content
        .map(item => {
          if (item.type === 'text') return item.text;
          if (item.type === 'tab') return '    ';
          if (item.type === 'break' && item.breakType !== 'page') return '\n';
          if (item.type === 'noBreakHyphen') return '\u2011';
          if (item.type === 'softHyphen') return '\u00ad';
          return '';
        })
        .join('');
      for (const character of text) {
        const latin = fonts[fontVariant(format)];
        const font =
          character === '\n' || supports(latin, character)
            ? latin
            : unicode && supports(unicode.font, character)
              ? unicode.font
              : fallbacks.find(candidate => supports(candidate.font, character))
                  ?.font;
        if (!font) {
          throw new DocxPdfFontError();
        }
        glyphs.push({
          text: character,
          font,
          size,
          format,
          width:
            character === '\n' ? 0 : font.widthOfTextAtSize(character, size),
          syntheticBold: font === unicode?.font && !!format.bold,
          syntheticItalic: font === unicode?.font && !!format.italic,
        });
      }
    }
    return glyphs;
  };
  const drawLine = (
    outputPage: PDFPage,
    glyphs: PdfGlyph[],
    x: number,
    top: number,
    availableWidth: number,
    alignment?: string,
    justify = false
  ) => {
    const chunks: { first: PdfGlyph; text: string; width: number }[] = [];
    for (let index = 0; index < glyphs.length; ) {
      const first = glyphs[index];
      let text = '';
      do {
        const glyph = glyphs[index++];
        text += glyph.text;
        if (justify && glyph.text === ' ') break;
      } while (
        index < glyphs.length &&
        glyphs[index].font === first.font &&
        glyphs[index].format === first.format
      );
      chunks.push({
        first,
        text,
        width: first.font.widthOfTextAtSize(text, first.size),
      });
    }
    const totalWidth = chunks.reduce((total, chunk) => total + chunk.width, 0);
    const size = Math.max(0, ...glyphs.map(glyph => glyph.size));
    const spaces = glyphs.filter(glyph => glyph.text === ' ').length;
    const extraSpace =
      justify && spaces ? Math.max(0, availableWidth - totalWidth) / spaces : 0;
    if (alignment === 'center')
      x += Math.max(0, (availableWidth - totalWidth) / 2);
    else if (alignment === 'right' || alignment === 'end')
      x += Math.max(0, availableWidth - totalWidth);
    for (const { first, text, width } of chunks) {
      const color = colorComponents(first.format.color);
      const baseline = top - size;
      outputPage.pushOperators(pushGraphicsState());
      if (first.syntheticBold) {
        outputPage.pushOperators(
          setTextRenderingMode(TextRenderingMode.FillAndOutline),
          setLineWidth(first.size * 0.025),
          setStrokingRgbColor(color.red, color.green, color.blue)
        );
      }
      outputPage.drawText(text, {
        x,
        y: baseline,
        size: first.size,
        font: first.font,
        color,
        ySkew: degrees(first.syntheticItalic ? 12 : 0),
      });
      outputPage.pushOperators(popGraphicsState());
      if (first.format.underline) {
        outputPage.drawLine({
          start: { x, y: baseline - first.size * 0.12 },
          end: { x: x + width, y: baseline - first.size * 0.12 },
          thickness: Math.max(0.5, first.size / 16),
          color: colorComponents(
            first.format.underline.color ?? first.format.color
          ),
        });
      }
      if (first.format.strike) {
        outputPage.drawLine({
          start: { x, y: baseline + first.size * 0.3 },
          end: { x: x + width, y: baseline + first.size * 0.3 },
          thickness: Math.max(0.5, first.size / 16),
          color,
        });
      }
      x += width + (text.endsWith(' ') ? extraSpace : 0);
    }
  };
  const storyGlyphs = (text: string) =>
    paragraphGlyphs(
      {
        type: 'paragraph',
        id: 'pdf-story',
        text,
        runs: [
          { content: [{ type: 'text', text }], format: { color: '#596370' } },
        ],
        fields: [],
        bookmarks: [],
      },
      9
    );
  let layout = layoutForSection(state.sections[0]);
  let sectionIndex = 0;
  let sectionPageIndex = 0;
  const pageLayouts: Array<{ layout: PageLayout; footer: string }> = [];
  let pageHasContent = false;
  let page: PDFPage;
  let y: number;

  const addPage = () => {
    const header = storyText(
      state,
      sectionIndex,
      'header',
      sectionPageIndex === 0
    );
    const footer = storyText(
      state,
      sectionIndex,
      'footer',
      sectionPageIndex === 0
    );
    pageLayouts.push({ layout, footer });
    sectionPageIndex++;
    pageHasContent = false;
    page = document.addPage([layout.width, layout.height]);
    y = layout.height - layout.top;
    if (header) {
      const lines = wrapGlyphs(
        storyGlyphs(header),
        () => layout.width - layout.left - layout.right
      );
      lines.forEach((line, index) =>
        drawLine(
          page,
          line,
          layout.left,
          layout.height - Math.max(18, layout.top * 0.5) - index * 11,
          layout.width - layout.left - layout.right
        )
      );
    }
    return page;
  };
  const ensureSpace = (height: number) => {
    if (y - height < layout.bottom) addPage();
  };
  const objectGraphic = (
    object: DocxEditableObject,
    availableWidth: number
  ) => {
    const preview = docxObjectPreview(object);
    const maximumHeight = Math.max(
      1,
      layout.height - layout.top - layout.bottom - 12
    );
    const width = object.type === 'equation' ? preview.width : object.widthPt;
    const height =
      object.type === 'equation' ? preview.height : object.heightPt;
    const scale = Math.min(
      width / preview.width,
      height / preview.height,
      availableWidth / preview.width,
      maximumHeight / preview.height
    );
    return {
      preview,
      scale,
      width: preview.width * scale,
      height: preview.height * scale,
    };
  };
  const drawObject = (
    graphic: ReturnType<typeof objectGraphic>,
    left: number,
    top: number
  ) => {
    const { preview, scale } = graphic;
    for (const shape of preview.shapes) {
      if (shape.type === 'rect')
        page.drawRectangle({
          x: left + shape.x * scale,
          y: top - (shape.y + shape.height) * scale,
          width: shape.width * scale,
          height: shape.height * scale,
          color: colorComponents(shape.fill),
        });
      else if (shape.type === 'path')
        page.drawSvgPath(shape.d, {
          x: left,
          y: top,
          scale,
          color: shape.fill ? colorComponents(shape.fill) : undefined,
          borderColor: shape.stroke ? colorComponents(shape.stroke) : undefined,
          borderWidth: shape.strokeWidth,
        });
      else {
        const format = { color: shape.fill };
        const glyphs = storyGlyphs(shape.text).map(glyph => ({
          ...glyph,
          size: shape.size * scale,
          width: glyph.font.widthOfTextAtSize(glyph.text, shape.size * scale),
          format,
        }));
        drawLine(
          page,
          glyphs,
          left + shape.x * scale,
          top - (shape.y - shape.size) * scale,
          graphic.width
        );
      }
    }
  };
  const drawInlineParagraph = async (paragraph: DocxParagraph) => {
    type Item =
      | { kind: 'glyph'; glyph: PdfGlyph; width: number; height: number }
      | { kind: 'image'; image: PDFImage; width: number; height: number }
      | {
          kind: 'object';
          graphic: ReturnType<typeof objectGraphic>;
          width: number;
          height: number;
        };
    const size = fontSize(paragraph);
    const indent = paragraph.properties?.indent;
    const left = layout.left + (indent?.leftPt ?? 0);
    const available = Math.max(
      1,
      layout.width - left - layout.right - (indent?.rightPt ?? 0)
    );
    const firstIndent = (indent?.firstLinePt ?? 0) - (indent?.hangingPt ?? 0);
    const tokens: Item[] = [];
    for (const run of paragraph.runs) {
      if (run.change === 'deleted') continue;
      for (const content of run.content) {
        if (content.type !== 'object') {
          for (const glyph of paragraphGlyphs({
            ...paragraph,
            runs: [{ ...run, content: [content] }],
          }))
            tokens.push({
              kind: 'glyph',
              glyph,
              width: glyph.width,
              height: glyph.size,
            });
          continue;
        }
        const source = content.part
          ? options.readPart?.(content.part)
          : undefined;
        const image = source
          ? await embedImage(document, source, content.contentType)
          : undefined;
        if (image) {
          const w = Math.max(1, content.widthPt ?? image.width);
          const h = Math.max(1, content.heightPt ?? image.height);
          const scale = Math.min(
            1,
            available / w,
            (layout.height - layout.top - layout.bottom - 6) / h
          );
          tokens.push({
            kind: 'image',
            image,
            width: w * scale,
            height: h * scale,
          });
        } else if (content.objectData) {
          const graphic = objectGraphic(content.objectData, available);
          tokens.push({
            kind: 'object',
            graphic,
            width: graphic.width,
            height: graphic.height,
          });
        } else {
          for (const glyph of storyGlyphs(`[${content.objectType}]`))
            tokens.push({
              kind: 'glyph',
              glyph,
              width: glyph.width,
              height: glyph.size,
            });
        }
      }
    }
    const lines: Item[][] = [];
    let line: Item[] = [],
      width = 0;
    const flush = () => {
      lines.push(line);
      line = [];
      width = 0;
    };
    for (const token of tokens) {
      if (token.kind === 'glyph' && token.glyph.text === '\n') {
        flush();
        continue;
      }
      if (
        line.length &&
        width + token.width > available - (lines.length ? 0 : firstIndent)
      )
        flush();
      line.push(token);
      width += token.width;
    }
    flush();
    const before = paragraph.properties?.spacing?.beforePt ?? 0;
    ensureSpace(before + size * 1.25);
    y -= before;
    for (const [index, items] of lines.entries()) {
      const offset = index === 0 ? firstIndent : 0;
      const width = items.reduce((sum, item) => sum + item.width, 0);
      // Match the editor's vertical-align: middle for inline object boxes.
      const textSize = Math.max(
        size,
        ...items.filter(item => item.kind === 'glyph').map(item => item.height)
      );
      const middle = textSize * 0.25;
      const objectHeight = Math.max(
        0,
        ...items.filter(item => item.kind !== 'glyph').map(item => item.height)
      );
      const ascent = Math.max(textSize, objectHeight / 2 + middle);
      const descent = Math.max(textSize * 0.25, objectHeight / 2 - middle);
      const height = Math.max(
        paragraph.properties?.spacing?.linePt ?? size * 1.25,
        ascent + descent
      );
      ensureSpace(height);
      const baseline = y - ascent;
      const alignment = paragraph.properties?.alignment;
      let x =
        left +
        offset +
        (alignment === 'center'
          ? Math.max(0, (available - offset - width) / 2)
          : alignment === 'right' || alignment === 'end'
            ? Math.max(0, available - offset - width)
            : 0);
      const spaces = items.filter(
        item => item.kind === 'glyph' && item.glyph.text === ' '
      ).length;
      const extra =
        alignment === 'both' && index < lines.length - 1 && spaces
          ? Math.max(0, available - offset - width) / spaces
          : 0;
      for (let cursor = 0; cursor < items.length; ) {
        const item = items[cursor++];
        if (item.kind === 'glyph') {
          const glyphs = [item.glyph];
          while (items[cursor]?.kind === 'glyph') {
            const next = items[cursor++];
            if (next.kind === 'glyph') glyphs.push(next.glyph);
          }
          const width = glyphs.reduce(
            (sum, g) => sum + g.width + (g.text === ' ' ? extra : 0),
            0
          );
          drawLine(
            page,
            glyphs,
            x,
            baseline + Math.max(...glyphs.map(g => g.size)),
            width,
            undefined,
            extra > 0
          );
          x += width;
        } else {
          if (item.kind === 'image')
            page.drawImage(item.image, {
              x,
              y: baseline + middle - item.height / 2,
              width: item.width,
              height: item.height,
            });
          else drawObject(item.graphic, x, baseline + middle + item.height / 2);
          x += item.width;
        }
      }
      y -= height;
    }
    y -= paragraph.properties?.spacing?.afterPt ?? Math.max(4, size * 0.35);
    pageHasContent = true;
  };
  const drawParagraphFragment = async (paragraph: DocxParagraph) => {
    if (pageHasContent && paragraph.properties?.pageBreakBefore) {
      addPage();
    }
    if (
      paragraph.runs.some(
        run =>
          run.change !== 'deleted' && run.content.some(c => c.type === 'object')
      )
    ) {
      await drawInlineParagraph(paragraph);
      return;
    }
    const size = fontSize(paragraph);
    const indent = paragraph.properties?.indent;
    const left = layout.left + (indent?.leftPt ?? 0);
    const availableWidth = Math.max(
      1,
      layout.width - left - layout.right - (indent?.rightPt ?? 0)
    );
    const firstIndent = (indent?.firstLinePt ?? 0) - (indent?.hangingPt ?? 0);
    const lines = wrapGlyphs(paragraphGlyphs(paragraph), line =>
      Math.max(1, availableWidth - (line === 0 ? firstIndent : 0))
    );
    const before = paragraph.properties?.spacing?.beforePt ?? 0;
    const after =
      paragraph.properties?.spacing?.afterPt ?? Math.max(4, size * 0.35);
    ensureSpace(before + size * 1.25);
    y -= before;
    for (const [index, line] of lines.entries()) {
      const lineHeight =
        paragraph.properties?.spacing?.linePt ??
        Math.max(size, ...line.map(glyph => glyph.size)) * 1.25;
      ensureSpace(lineHeight);
      const offset = index === 0 ? firstIndent : 0;
      drawLine(
        page,
        line,
        left + offset,
        y,
        availableWidth - offset,
        paragraph.properties?.alignment,
        paragraph.properties?.alignment === 'both' && index < lines.length - 1
      );
      y -= lineHeight;
    }
    y -= after;
    pageHasContent = true;
  };

  const drawParagraph = async (paragraph: DocxParagraph) => {
    for (const [index, part] of splitDocxParagraphPages(paragraph).entries()) {
      if (index) addPage();
      await drawParagraphFragment(part.paragraph);
    }
  };

  type CellItem =
    | { kind: 'space'; height: number }
    | {
        kind: 'line';
        height: number;
        glyphs: PdfGlyph[];
        left: number;
        width: number;
        alignment?: string;
        justify: boolean;
      }
    | { kind: 'image'; height: number; width: number; image: PDFImage }
    | ({ kind: 'object' } & ReturnType<typeof objectGraphic>);
  const cellItems = async (blocks: readonly DocxBlock[], width: number) => {
    const items: CellItem[] = [];
    for (const paragraph of collectParagraphs(blocks)) {
      const size = fontSize(paragraph);
      const indent = paragraph.properties?.indent;
      const left = Math.max(0, indent?.leftPt ?? 0);
      const available = Math.max(1, width - left - (indent?.rightPt ?? 0));
      const firstIndent = (indent?.firstLinePt ?? 0) - (indent?.hangingPt ?? 0);
      const lines = wrapGlyphs(paragraphGlyphs(paragraph), line =>
        Math.max(1, available - (line === 0 ? firstIndent : 0))
      );
      items.push({
        kind: 'space',
        height: Math.max(0, paragraph.properties?.spacing?.beforePt ?? 0),
      });
      for (const [index, glyphs] of lines.entries()) {
        const offset = index === 0 ? firstIndent : 0;
        items.push({
          kind: 'line',
          glyphs,
          height: Math.max(size, ...glyphs.map(glyph => glyph.size)) * 1.25,
          left: left + offset,
          width: Math.max(1, available - offset),
          alignment: paragraph.properties?.alignment,
          justify:
            paragraph.properties?.alignment === 'both' &&
            index < lines.length - 1,
        });
      }
      for (const run of paragraph.runs) {
        if (run.change === 'deleted') continue;
        for (const content of run.content) {
          if (content.type !== 'object') continue;
          const source = content.part
            ? options.readPart?.(content.part)
            : undefined;
          const image = source
            ? await embedImage(document, source, content.contentType)
            : undefined;
          if (image) {
            const requestedWidth = Math.max(1, content.widthPt ?? image.width);
            const requestedHeight = Math.max(
              1,
              content.heightPt ?? image.height
            );
            const maximumHeight = Math.max(
              1,
              layout.height - layout.top - layout.bottom - 12
            );
            const scale = Math.min(
              1,
              width / requestedWidth,
              maximumHeight / requestedHeight
            );
            items.push({
              kind: 'image',
              image,
              width: requestedWidth * scale,
              height: requestedHeight * scale,
            });
          } else if (content.objectData) {
            items.push({
              kind: 'object',
              ...objectGraphic(content.objectData, width),
            });
          } else {
            items.push({
              kind: 'line',
              height: 14,
              glyphs: storyGlyphs(`[${content.objectType}]`),
              left: 0,
              width,
              justify: false,
            });
          }
        }
      }
      items.push({
        kind: 'space',
        height: Math.max(0, paragraph.properties?.spacing?.afterPt ?? 4),
      });
    }
    return items;
  };
  const drawTable = async (table: DocxTable) => {
    const columns = table.rows.reduce(
      (maximum, row) =>
        Math.max(
          maximum,
          row.cells.reduce(
            (sum, cell) => sum + Math.max(1, cell.gridSpan ?? 1),
            0
          )
        ),
      1
    );
    if (!Number.isSafeInteger(columns) || columns > 256)
      throw new Error('DOCX table has too many columns for PDF export');
    const available = Math.max(1, layout.width - layout.left - layout.right);
    const requested =
      table.widthType === 'pct'
        ? (available * (table.widthTwips ?? 5000)) / 5000
        : (table.widthTwips ?? 0) / 20;
    const width = requested > 0 ? Math.min(available, requested) : available;
    const weights = Array.from({ length: columns }, (_, index) =>
      Math.max(1, table.columnWidthsTwips?.[index] ?? 1)
    );
    const total = weights.reduce((sum, value) => sum + value, 0);
    const widths = weights.map(value => (width * value) / total);
    const padding = 4;
    for (const row of table.rows) {
      let column = 0;
      let left = layout.left;
      const cells = [];
      for (const cell of row.cells) {
        const span = Math.max(1, cell.gridSpan ?? 1);
        const cellWidth = widths
          .slice(column, column + span)
          .reduce((sum, value) => sum + value, 0);
        cells.push({
          left,
          width: cellWidth,
          items: await cellItems(
            cell.blocks,
            Math.max(1, cellWidth - padding * 2)
          ),
          offset: 0,
        });
        left += cellWidth;
        column += span;
      }
      const fullHeight = Math.max(
        18,
        ...cells.map(cell =>
          cell.items.reduce((sum, item) => sum + item.height, padding * 2)
        )
      );
      const pageHeight = layout.height - layout.top - layout.bottom;
      if (fullHeight <= pageHeight && y - fullHeight < layout.bottom) addPage();
      let firstChunk = true;
      while (
        firstChunk ||
        cells.some(cell => cell.offset < cell.items.length)
      ) {
        firstChunk = false;
        if (y - layout.bottom < 24) addPage();
        const capacity = Math.max(1, y - layout.bottom - padding * 2);
        const chunks = cells.map(cell => {
          const items: CellItem[] = [];
          let height = 0;
          while (cell.offset < cell.items.length) {
            const next = cell.items[cell.offset];
            if (height + next.height > capacity) break;
            items.push(next);
            height += next.height;
            cell.offset++;
          }
          return { cell, items, height };
        });
        if (
          chunks.every(chunk => chunk.items.length === 0) &&
          cells.some(cell => cell.offset < cell.items.length)
        ) {
          if (y < layout.height - layout.top) {
            addPage();
            continue;
          }
          throw new Error(
            'DOCX table content exceeds the available PDF page height'
          );
        }
        const height = Math.max(
          18,
          ...chunks.map(chunk => chunk.height + padding * 2)
        );
        for (const { cell, items } of chunks) {
          page.drawRectangle({
            x: cell.left,
            y: y - height,
            width: cell.width,
            height,
            borderWidth: 0.5,
            borderColor: rgb(0.55, 0.59, 0.64),
          });
          let top = y - padding;
          for (const item of items) {
            if (item.kind === 'line') {
              drawLine(
                page,
                item.glyphs,
                cell.left + padding + item.left,
                top,
                item.width,
                item.alignment,
                item.justify
              );
            } else if (item.kind === 'object') {
              drawObject(item, cell.left + padding, top);
            } else if (item.kind === 'image') {
              page.drawImage(item.image, {
                x: cell.left + padding,
                y: top - item.height,
                width: item.width,
                height: item.height,
              });
            }
            top -= item.height;
          }
        }
        y -= height;
        pageHasContent = true;
        if (cells.some(cell => cell.offset < cell.items.length)) addPage();
      }
    }
    y -= 6;
  };

  addPage();
  const drawBlocks = async (blocks: readonly DocxBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'paragraph') {
        await drawParagraph(block);
      } else if (block.type === 'contentControl') {
        await drawBlocks(block.blocks);
      } else if (block.type === 'table') {
        await drawTable(block);
      }
    }
  };
  for (const range of docxSectionRanges(state.body, state.sections)) {
    if (range.sectionIndex !== sectionIndex) {
      const section = state.sections[range.sectionIndex];
      const nextLayout = layoutForSection(section);
      const requiresPage =
        docxSectionNeedsPage(section) ||
        nextLayout.width !== layout.width ||
        nextLayout.height !== layout.height;
      if (
        requiresPage &&
        docxSectionNeedsParityPage(section, document.getPageCount() + 1)
      )
        addPage();
      sectionIndex = range.sectionIndex;
      sectionPageIndex = 0;
      layout = nextLayout;
      if (requiresPage) addPage();
    }
    await drawBlocks(range.blocks);
  }
  const pages = document.getPages();
  pages.forEach((outputPage, index) => {
    const { layout, footer } = pageLayouts[index];
    if (footer) {
      const lines = wrapGlyphs(
        storyGlyphs(footer),
        () => layout.width - layout.left - layout.right
      );
      lines.forEach((line, lineIndex) =>
        drawLine(
          outputPage,
          line,
          layout.left,
          Math.max(27, layout.bottom * 0.45 + 9) - lineIndex * 11,
          layout.width - layout.left - layout.right
        )
      );
    }
    outputPage.drawText(String(index + 1), {
      x: layout.width - layout.right,
      y: Math.max(12, layout.bottom * 0.3),
      size: 8,
      font: fonts.regular,
      color: rgb(0.45, 0.48, 0.52),
    });
  });
  await unicode?.finalize();
  for (const fallback of fallbacks) await fallback.finalize();
  return await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}
