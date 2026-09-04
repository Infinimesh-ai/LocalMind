import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  rgb,
  StandardFonts,
} from 'pdf-lib';

import {
  type DocxBlock,
  type DocxParagraph,
  type DocxSemanticState,
} from './semantic';

export type DocxPdfExportOptions = {
  title?: string;
  author?: string;
  readPart?: (partName: string) => Uint8Array | undefined;
};

type PageLayout = {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type FontVariant = 'regular' | 'bold' | 'italic' | 'boldItalic';

const DEFAULT_LAYOUT: PageLayout = {
  width: 612,
  height: 792,
  top: 72,
  right: 72,
  bottom: 72,
  left: 72,
};

function layoutForState(state: DocxSemanticState): PageLayout {
  const section = state.sections[0];
  return {
    width: section?.pageSize?.widthPt ?? DEFAULT_LAYOUT.width,
    height: section?.pageSize?.heightPt ?? DEFAULT_LAYOUT.height,
    top: section?.margins?.topPt ?? DEFAULT_LAYOUT.top,
    right: section?.margins?.rightPt ?? DEFAULT_LAYOUT.right,
    bottom: section?.margins?.bottomPt ?? DEFAULT_LAYOUT.bottom,
    left: section?.margins?.leftPt ?? DEFAULT_LAYOUT.left,
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

function storyText(state: DocxSemanticState, kind: 'header' | 'footer') {
  const story = state.stories.find(
    candidate =>
      candidate.kind === kind && (candidate.type ?? 'default') === 'default'
  );
  return story
    ? collectParagraphs(story.blocks)
        .map(item => item.text)
        .join(' ')
    : '';
}

function fontVariant(paragraph: DocxParagraph): FontVariant {
  const format = paragraph.runs.find(run => run.format)?.format;
  if (format?.bold && format.italic) return 'boldItalic';
  if (format?.bold) return 'bold';
  if (format?.italic) return 'italic';
  return 'regular';
}

function fontSize(paragraph: DocxParagraph) {
  const explicit = paragraph.runs.find(run => run.format?.fontSizePt)?.format
    ?.fontSizePt;
  if (explicit) return Math.max(4, Math.min(72, explicit));
  const outline = paragraph.properties?.outlineLevel;
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

function encodableText(font: PDFFont, text: string) {
  let output = '';
  for (const character of text) {
    try {
      font.encodeText(character);
      output += character;
    } catch {
      output += '?';
    }
  }
  return output;
}

function wrapText(font: PDFFont, text: string, size: number, width: number) {
  const logicalLines = text.split('\n');
  const lines: string[] = [];
  for (const logicalLine of logicalLines) {
    if (!logicalLine) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const token of logicalLine.split(/(\s+)/)) {
      const candidate = current ? `${current}${token}` : token;
      if (font.widthOfTextAtSize(candidate, size) <= width || !current) {
        current = candidate;
        continue;
      }
      lines.push(current.trimEnd());
      current = token.trimStart();
      while (current && font.widthOfTextAtSize(current, size) > width) {
        let split = 1;
        while (
          split < current.length &&
          font.widthOfTextAtSize(current.slice(0, split + 1), size) <= width
        ) {
          split++;
        }
        lines.push(current.slice(0, split));
        current = current.slice(split);
      }
    }
    lines.push(current.trimEnd());
  }
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
  const layout = layoutForState(state);
  const header = storyText(state, 'header');
  const footer = storyText(state, 'footer');
  let page: PDFPage;
  let y: number;

  const addPage = () => {
    page = document.addPage([layout.width, layout.height]);
    y = layout.height - layout.top;
    if (header) {
      page.drawText(encodableText(fonts.regular, header), {
        x: layout.left,
        y: layout.height - Math.max(24, layout.top * 0.5),
        size: 9,
        font: fonts.regular,
        color: rgb(0.35, 0.39, 0.44),
        maxWidth: layout.width - layout.left - layout.right,
      });
    }
    return page;
  };
  const ensureSpace = (height: number) => {
    if (y - height < layout.bottom) addPage();
  };
  const drawParagraph = async (paragraph: DocxParagraph) => {
    if (
      paragraph.properties?.pageBreakBefore ||
      paragraph.runs.some(run =>
        run.content.some(
          content => content.type === 'break' && content.breakType === 'page'
        )
      )
    ) {
      addPage();
    }
    const size = fontSize(paragraph);
    const font = fonts[fontVariant(paragraph)];
    const text = encodableText(font, paragraph.text);
    const availableWidth = layout.width - layout.left - layout.right;
    const lines = wrapText(font, text, size, availableWidth);
    const lineHeight = paragraph.properties?.spacing?.linePt ?? size * 1.25;
    const before = paragraph.properties?.spacing?.beforePt ?? 0;
    const after =
      paragraph.properties?.spacing?.afterPt ?? Math.max(4, size * 0.35);
    ensureSpace(before + Math.max(1, lines.length) * lineHeight + after);
    y -= before;
    for (const line of lines) {
      page.drawText(line, {
        x: layout.left + (paragraph.properties?.indent?.leftPt ?? 0),
        y: y - size,
        size,
        font,
        color: colorComponents(
          paragraph.runs.find(run => run.format?.color)?.format?.color
        ),
        maxWidth: availableWidth,
      });
      y -= lineHeight;
    }
    for (const run of paragraph.runs) {
      for (const content of run.content) {
        if (content.type !== 'object') continue;
        const source = content.part
          ? options.readPart?.(content.part)
          : undefined;
        const image = source
          ? await embedImage(document, source, content.contentType)
          : undefined;
        if (image) {
          const width = Math.min(
            content.widthPt ?? image.width,
            availableWidth
          );
          const height = Math.min(
            content.heightPt ?? image.height,
            width * (image.height / image.width)
          );
          ensureSpace(height + 6);
          page.drawImage(image, {
            x: layout.left,
            y: y - height,
            width,
            height,
          });
          y -= height + 6;
        } else {
          ensureSpace(18);
          page.drawText(`[${content.objectType}]`, {
            x: layout.left,
            y: y - 10,
            size: 9,
            font: fonts.italic,
            color: rgb(0.35, 0.39, 0.44),
          });
          y -= 18;
        }
      }
    }
    y -= after;
  };

  addPage();
  const drawBlocks = async (blocks: readonly DocxBlock[]) => {
    for (const block of blocks) {
      if (block.type === 'paragraph') {
        await drawParagraph(block);
      } else if (block.type === 'contentControl') {
        await drawBlocks(block.blocks);
      } else if (block.type === 'table') {
        for (const row of block.rows) {
          const cellText = row.cells
            .map(cell =>
              collectParagraphs(cell.blocks)
                .map(item => item.text)
                .join(' ')
            )
            .join(' | ');
          await drawParagraph({
            type: 'paragraph',
            id: `pdf-table-row:${row.cells.length}:${cellText.length}`,
            runs: [{ content: [{ type: 'text', text: cellText }] }],
            text: cellText,
            fields: [],
            bookmarks: [],
          });
        }
      }
    }
  };
  await drawBlocks(state.body);
  const pages = document.getPages();
  pages.forEach((outputPage, index) => {
    if (footer) {
      outputPage.drawText(encodableText(fonts.regular, footer), {
        x: layout.left,
        y: Math.max(18, layout.bottom * 0.45),
        size: 9,
        font: fonts.regular,
        color: rgb(0.35, 0.39, 0.44),
        maxWidth: layout.width - layout.left - layout.right,
      });
    }
    outputPage.drawText(String(index + 1), {
      x: layout.width - layout.right,
      y: Math.max(12, layout.bottom * 0.3),
      size: 8,
      font: fonts.regular,
      color: rgb(0.45, 0.48, 0.52),
    });
  });
  return await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}
