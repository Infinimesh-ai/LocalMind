import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import {
  projectReportAudience,
  type ReportAudience,
  type ReportDocument,
  type ReportRenderAsset,
} from '@localmind/office/report';
import { renderProjectedReport } from '@localmind/office/report-render';
import { createCanvas, loadImage } from '@napi-rs/canvas';

import { inspectImageForProxy } from '../../native';

const require = createRequire(import.meta.url);
let font: Promise<{ bytes: Uint8Array; license: string }> | undefined;
function reportFont() {
  return (font ??= Promise.all([
    readFile(require.resolve('@localmind/office/report-font')),
    readFile(require.resolve('@localmind/office/report-font-license'), 'utf8'),
  ])
    .then(([bytes, license]) => ({ bytes, license }))
    .catch(error => {
      font = undefined;
      throw error;
    }));
}

/** Only byte input is accepted; the resulting PNG has no source metadata. */
export async function normalizeProjectReportAsset(
  source: { bytes: Uint8Array; mimeType: string },
  remainingPixels = 40_000_000
) {
  if (source.bytes.length > 20 * 1024 * 1024)
    throw new Error('REPORT_ASSET_SIZE_LIMIT');
  if (
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
      source.mimeType
    )
  )
    throw new Error('REPORT_ASSET_MIME_MISMATCH');
  if (remainingPixels <= 0) throw new Error('REPORT_ASSET_PIXEL_LIMIT');
  const bytes = Buffer.from(source.bytes);
  const dimensions = inspectImageForProxy(bytes, {
    maxWidth: 16000,
    maxHeight: 16000,
    maxPixels: Math.min(40_000_000, remainingPixels),
  });
  if (dimensions.mimeType !== source.mimeType)
    throw new Error('REPORT_ASSET_MIME_MISMATCH');
  const image = await loadImage(bytes);
  const canvas = createCanvas(dimensions.width, dimensions.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  const normalized = await canvas.encode('png');
  if (normalized.length > 20 * 1024 * 1024)
    throw new Error('REPORT_ASSET_SIZE_LIMIT');
  return {
    bytes: normalized,
    mimeType: 'image/png' as const,
    width: dimensions.width,
    height: dimensions.height,
  };
}

/** The caller must load only the projection's assets through the Project blob ACL. */
export async function renderProjectReport(input: {
  document: ReportDocument;
  audience: ReportAudience;
  format: 'pdf' | 'pptx' | 'offline';
  assets: ReadonlyMap<string, { bytes: Uint8Array; mimeType: string }>;
}) {
  const projection = projectReportAudience(input.document, input.audience);
  const assets = new Map<string, ReportRenderAsset>();
  const compatibility: { code: string; message: string; nodeId?: string }[] =
    [];
  const allowed = new Set(projection.assets.map(asset => asset.id));
  if (
    input.assets.size !== allowed.size ||
    [...input.assets.keys()].some(id => !allowed.has(id))
  )
    throw new Error('REPORT_ASSET_PROJECTION_MISMATCH');
  let total = 0;
  let totalPixels = 0;
  for (const [id, source] of input.assets) {
    total += source.bytes.length;
    if (source.bytes.length > 20 * 1024 * 1024 || total > 100 * 1024 * 1024)
      throw new Error('REPORT_ASSET_SIZE_LIMIT');
    const asset = await normalizeProjectReportAsset(
      source,
      80_000_000 - totalPixels
    );
    totalPixels += asset.width * asset.height;
    assets.set(id, asset);
    if (source.mimeType === 'image/gif' || source.mimeType === 'image/webp')
      compatibility.push({
        code: 'static_image',
        message: 'Animated images are exported as a fixed first frame.',
        nodeId: id,
      });
  }
  const result = await renderProjectedReport({
    projection,
    format: input.format,
    assets,
    font: await reportFont(),
  });
  return {
    ...result,
    compatibility: [...compatibility, ...result.compatibility],
  };
}
