import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName, PDFStream, rgb } from 'pdf-lib';

import { reportChartShapes } from './chart';
import {
  reportChapterLayouts,
  type ReportLayout,
  reportSlideBackgroundAssetId,
} from './layout';
import type { ReportRenderInput } from './render-types';
const color = (value: string) =>
  rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255
  );
export async function exportReportPdf(
  input: ReportRenderInput,
  layout: ReportLayout
) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  document.setTitle(input.projection.title);
  document.setProducer('LocalMind Project Reports');
  document.setCreator('LocalMind');
  const font = await document.embedFont(input.font.bytes, { subset: false });
  const images = new Map<
    string,
    Awaited<ReturnType<typeof document.embedPng>>
  >();
  for (const [id, asset] of input.assets)
    images.set(
      id,
      asset.mimeType === 'image/png'
        ? await document.embedPng(asset.bytes)
        : await document.embedJpg(asset.bytes)
    );
  const foreground = color(input.projection.theme.foreground),
    accent = color(input.projection.theme.accent);
  const chapterLayouts = reportChapterLayouts(input.projection);
  for (const [index, slide] of layout.slides.entries()) {
    const page = document.addPage([layout.width, layout.height]);
    page.drawRectangle({
      width: layout.width,
      height: layout.height,
      color: color(input.projection.theme.background),
    });
    const backgroundId = reportSlideBackgroundAssetId(
      input.projection.theme,
      chapterLayouts.get(slide.chapterId)
    );
    const background = backgroundId ? images.get(backgroundId) : undefined;
    if (background)
      page.drawImage(background, {
        x: 0,
        y: 0,
        width: layout.width,
        height: layout.height,
      });
    const text = (
      value: string,
      x: number,
      y: number,
      size: number,
      fill = foreground
    ) =>
      value.split('\n').forEach((line, index) =>
        page.drawText(line, {
          x,
          y: layout.height - y - size - index * size * 1.45,
          size,
          font,
          color: fill,
        })
      );
    text(slide.title, 48, 28, 26);
    text(
      `${index + 1} / ${layout.slides.length}`,
      layout.width - 96,
      layout.height - 28,
      12
    );
    const logo = input.projection.theme.logoAssetId
      ? images.get(input.projection.theme.logoAssetId)
      : undefined;
    if (logo) {
      const scale = Math.min(40 / logo.width, 40 / logo.height);
      page.drawImage(logo, {
        x: layout.width - 80,
        y: layout.height - 64,
        width: logo.width * scale,
        height: logo.height * scale,
      });
    }
    for (const element of slide.elements) {
      if (element.type === 'text')
        text(
          element.text,
          element.x,
          element.y,
          element.size,
          element.emphasis ? accent : foreground
        );
      else if (element.type === 'image') {
        const image = images.get(element.assetId);
        if (!image) throw new Error('REPORT_MISSING_ASSET');
        const scale = Math.min(
          element.width / image.width,
          element.height / image.height
        );
        page.drawImage(image, {
          x: element.x + (element.width - image.width * scale) / 2,
          y:
            layout.height -
            element.y -
            (element.height + image.height * scale) / 2,
          width: image.width * scale,
          height: image.height * scale,
        });
      } else if (element.type === 'table') {
        let top = element.y;
        [element.columns, ...element.rows].forEach((row, index) => {
          const height =
              Math.max(...row.map(cell => cell.split('\n').length)) * 20 + 14,
            width = element.width / row.length;
          row.forEach((cell, column) => {
            page.drawRectangle({
              x: element.x + column * width,
              y: layout.height - top - height,
              width,
              height,
              color:
                index === 0 ? accent : color(input.projection.theme.background),
              borderColor: rgb(0.8, 0.8, 0.82),
              borderWidth: 0.5,
            });
            text(
              cell,
              element.x + column * width + 8,
              top + 7,
              element.size,
              index === 0 ? rgb(1, 1, 1) : foreground
            );
          });
          top += height;
        });
      } else {
        for (const shape of reportChartShapes(
          element.node,
          element.width,
          element.height,
          input.projection.theme.foreground
        )) {
          if (shape.type === 'text')
            text(
              shape.text,
              element.x + shape.x,
              element.y + shape.y - shape.size,
              shape.size,
              color(shape.fill)
            );
          else if (shape.type === 'rect')
            page.drawRectangle({
              x: element.x + shape.x,
              y: layout.height - element.y - shape.y - shape.height,
              width: shape.width,
              height: shape.height,
              color: color(shape.fill),
            });
          else
            page.drawSvgPath(shape.d, {
              x: element.x,
              y: layout.height - element.y,
              color: shape.fill ? color(shape.fill) : undefined,
              borderColor: shape.stroke ? color(shape.stroke) : undefined,
              borderWidth: shape.strokeWidth,
            });
        }
      }
    }
  }
  // The bundled fontkit exposes CFF data differently from pdf-lib's old probe.
  // Correct the PDF font dictionaries for the complete OpenType CFF container.
  await font.embed();
  if (
    new TextDecoder('ascii').decode(input.font.bytes.slice(0, 4)) === 'OTTO'
  ) {
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict)) continue;
      const fontFile =
        object.get(PDFName.of('FontFile2')) ??
        object.get(PDFName.of('FontFile3'));
      if (fontFile) {
        const stream = document.context.lookup(fontFile);
        if (stream instanceof PDFStream)
          stream.dict.set(PDFName.of('Subtype'), PDFName.of('OpenType'));
        object.delete(PDFName.of('FontFile2'));
        object.set(PDFName.of('FontFile3'), fontFile);
      }
      if (object.get(PDFName.of('Subtype')) === PDFName.of('CIDFontType2')) {
        object.set(PDFName.of('Subtype'), PDFName.of('CIDFontType0'));
        object.delete(PDFName.of('CIDToGIDMap'));
      }
    }
  }
  return document.save({ useObjectStreams: false });
}
