/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { strFromU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { projectReportAudience } from './audience';
import { createReportDocument } from './document';
import { importReportTemplateFromPptx } from './import-template';
import { renderProjectedReport } from './render';
import { ReportTemplateSchema } from './schema';
import { BUILTIN_REPORT_TEMPLATES } from './templates';

const font = {
  bytes: readFileSync(
    new URL(
      '../../assets/report-fonts/NotoSansCJKsc-Regular.otf',
      import.meta.url
    )
  ),
  license: 'test',
};
// 1×1 PNGs that differ only in their pixel.
const png = (pixel: string) => Uint8Array.from(Buffer.from(pixel, 'base64'));
const coverPng = png(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
);
const backgroundPng = png(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
);

async function exportedDeck() {
  const template = ReportTemplateSchema.parse({
    ...BUILTIN_REPORT_TEMPLATES[1].content,
    assets: [
      { id: 'cover', blobKey: 'cover-blob', mimeType: 'image/png', alt: 'c' },
      { id: 'bg', blobKey: 'bg-blob', mimeType: 'image/png', alt: 'b' },
    ],
    theme: {
      ...BUILTIN_REPORT_TEMPLATES[1].content.theme,
      coverAssetId: 'cover',
      backgroundAssetId: 'bg',
    },
  });
  const report = createReportDocument({
    title: '导入测试',
    creator: { actorId: 'actor', label: '创建者' },
    period: {
      start: '2026-10-01T00:00:00Z',
      end: '2026-10-08T00:00:00Z',
      timeZone: 'Asia/Shanghai',
      weekStartsOn: 1,
    },
    template,
    now: '2026-10-08T00:00:00Z',
  });
  const projection = projectReportAudience(report, {
    kind: 'internal',
    chapterIds: report.chapters.map(chapter => chapter.id),
    includeNotes: false,
    includeSources: false,
  });
  const publicId = (id: string) =>
    id === 'cover'
      ? projection.theme.coverAssetId!
      : projection.theme.backgroundAssetId!;
  const result = await renderProjectedReport({
    projection,
    format: 'pptx',
    assets: new Map([
      [publicId('cover'), { bytes: coverPng, mimeType: 'image/png' }],
      [publicId('bg'), { bytes: backgroundPng, mimeType: 'image/png' }],
    ]),
    font,
  });
  return { result, template };
}

describe('Report template import from PowerPoint', () => {
  it('exports theme images behind every slide and reads them back', async () => {
    const { result, template } = await exportedDeck();
    const entries = unzipSync(result.bytes);
    const slide1 = strFromU8(entries['ppt/slides/slide1.xml']);
    // The background picture is the first shape, behind the slide text.
    expect(slide1.indexOf('<p:pic>')).toBeGreaterThan(-1);
    expect(slide1.indexOf('<p:pic>')).toBeLessThan(slide1.indexOf('<p:sp>'));
    const imported = importReportTemplateFromPptx(result.bytes);
    expect(imported.theme.aspectRatio).toBe('16:9');
    // The exported deck opens with its own title slide, then one per chapter.
    expect(imported.chapters.map(chapter => chapter.title)).toEqual(
      expect.arrayContaining(template.chapters.map(chapter => chapter.title))
    );
    expect(imported.chapters[0].layout).toBe('cover');
    expect(imported.cover?.bytes).toEqual(coverPng);
    expect(imported.background?.bytes).toEqual(backgroundPng);
  }, 60000);

  it('accepts .potx packages and uses the embedded thumbnail as preview', async () => {
    const { result } = await exportedDeck();
    const entries = unzipSync(result.bytes);
    const types = strFromU8(entries['[Content_Types].xml']).replace(
      'presentationml.presentation.main+xml',
      'presentationml.template.main+xml'
    );
    entries['[Content_Types].xml'] = new TextEncoder().encode(
      types.replace(
        '</Types>',
        '<Override PartName="/docProps/thumbnail.png" ContentType="image/png"/></Types>'
      )
    );
    entries['docProps/thumbnail.png'] = coverPng;
    entries['_rels/.rels'] = new TextEncoder().encode(
      strFromU8(entries['_rels/.rels']).replace(
        '</Relationships>',
        '<Relationship Id="thumb" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.png"/></Relationships>'
      )
    );
    const imported = importReportTemplateFromPptx(zipSync(entries));
    expect(imported.preview?.mimeType).toBe('image/png');
    expect(imported.chapters.length).toBeGreaterThan(0);
  }, 60000);

  it('rejects files that are not presentations', () => {
    expect(() =>
      importReportTemplateFromPptx(new TextEncoder().encode('not a deck'))
    ).toThrow();
  });
});
