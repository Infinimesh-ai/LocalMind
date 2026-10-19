import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';

import { ReportProjectionSchema } from './audience';
import { exportReportOffline } from './export-offline';
import { exportReportPdf } from './export-pdf';
import { exportReportPptx } from './export-pptx';
import { layoutReport } from './layout';
import {
  REPORT_RENDERER_VERSION,
  type ReportCompatibility,
  type ReportRenderInput,
} from './render-types';

/** Pure byte rendering: no network, local paths, credentials or resource lookup. */
export async function renderProjectedReport(input: ReportRenderInput) {
  const projection = ReportProjectionSchema.parse(input.projection);
  input = { ...input, projection };
  for (const value of [
    projection.theme.background,
    projection.theme.foreground,
    projection.theme.accent,
  ])
    if (!/^#[a-f\d]{6}$/i.test(value)) throw new Error('REPORT_INVALID_THEME');
  const required = new Set(projection.assets.map(asset => asset.id));
  if (
    required.size !== projection.assets.length ||
    input.assets.size !== required.size ||
    [...input.assets.keys()].some(id => !required.has(id))
  )
    throw new Error('REPORT_ASSET_PROJECTION_MISMATCH');
  const font = fontkit.create(input.font.bytes);
  const measure = (text: string, size: number) =>
    (font
      .layout(text)
      .positions.reduce((sum, position) => sum + position.xAdvance, 0) /
      font.unitsPerEm) *
    size;
  const strings = JSON.stringify(projection);
  for (const char of new Set(Array.from(strings))) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && !font.hasGlyphForCodePoint(code))
      throw new Error(
        `REPORT_FONT_MISSING_GLYPH:U+${code.toString(16).toUpperCase()}`
      );
  }
  const notes =
    input.format === 'pdf'
      ? projection.chapters
          .filter(chapter => chapter.notes)
          .map((chapter, index) => ({
            id: `chapter-notes-${index}`,
            title: `${projection.language === 'en' ? 'Speaker notes' : '演讲备注'} · ${chapter.title}`,
            layout: 'content' as const,
            notes: '',
            nodes: [
              {
                id: `notes-${index}`,
                type: 'paragraph' as const,
                text: chapter.notes,
                claimKind: 'manual' as const,
                sources: [],
              },
            ],
          }))
      : [];
  const layout = layoutReport(
    { ...projection, chapters: [...projection.chapters, ...notes] },
    measure
  );
  // Decode supported bytes before rendering, and preserve aspect ratio in every format.
  const inspection = await PDFDocument.create();
  let totalPixels = 0;
  for (const [id, asset] of input.assets) {
    if (asset.bytes.length > 20 * 1024 * 1024)
      throw new Error('REPORT_ASSET_SIZE_LIMIT');
    if (asset.mimeType === 'image/png') {
      if (asset.bytes.length < 24) throw new Error('REPORT_INVALID_IMAGE');
      const header = new DataView(
        asset.bytes.buffer,
        asset.bytes.byteOffset,
        asset.bytes.byteLength
      );
      if (
        header.getUint32(0) !== 0x89504e47 ||
        header.getUint32(4) !== 0x0d0a1a0a
      )
        throw new Error('REPORT_INVALID_IMAGE');
      if (header.getUint32(16) * header.getUint32(20) > 40_000_000)
        throw new Error('REPORT_ASSET_PIXEL_LIMIT');
    }
    const image =
      asset.mimeType === 'image/png'
        ? await inspection.embedPng(asset.bytes)
        : await inspection.embedJpg(asset.bytes);
    totalPixels += image.width * image.height;
    if (image.width * image.height > 40_000_000 || totalPixels > 80_000_000)
      throw new Error('REPORT_ASSET_PIXEL_LIMIT');
    for (const slide of layout.slides)
      for (const element of slide.elements)
        if (element.type === 'image' && element.assetId === id) {
          const scale = Math.min(
              element.width / image.width,
              element.height / image.height
            ),
            width = image.width * scale,
            height = image.height * scale;
          element.x += (element.width - width) / 2;
          element.y += (element.height - height) / 2;
          element.width = width;
          element.height = height;
        }
  }
  const compatibility: ReportCompatibility[] = [];
  if (projection.theme.fontFamily === 'serif')
    compatibility.push({
      code: 'font_substitution',
      message:
        'Noto Sans CJK SC is embedded for searchable simplified/traditional Chinese; serif styling is substituted.',
    });
  if (input.format === 'pptx')
    compatibility.push({
      code: 'viewer_font_required',
      message:
        'Editable text uses Noto Sans CJK SC; PowerPoint may substitute a local CJK font when it is not installed.',
    });
  const bytes =
    input.format === 'pdf'
      ? await exportReportPdf(input, layout)
      : input.format === 'pptx'
        ? exportReportPptx(input, layout)
        : exportReportOffline(input, layout);
  return {
    bytes,
    mimeType:
      input.format === 'pdf'
        ? 'application/pdf'
        : input.format === 'pptx'
          ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          : 'application/zip',
    extension: input.format === 'offline' ? 'zip' : input.format,
    compatibility,
    pageCount: layout.slides.length,
    rendererVersion: REPORT_RENDERER_VERSION,
  };
}
