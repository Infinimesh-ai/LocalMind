import assert from 'node:assert/strict';

import {
  BUILTIN_REPORT_TEMPLATES,
  createReportDocument,
  ReportNodeSchema,
} from '@localmind/office/report';
import { createCanvas } from '@napi-rs/canvas';
import { strFromU8, unzipSync, zipSync } from 'fflate';

import {
  normalizeProjectReportAsset,
  renderProjectReport,
} from '../../core/project-report/export-renderer';

async function main() {
  const document = createReportDocument({
    title: '汇报导出验收 / 匯報',
    creator: { actorId: 'private-creator', label: '创建人' },
    template: BUILTIN_REPORT_TEMPLATES[0].content,
    period: {
      start: '2026-10-01T00:00:00Z',
      end: '2026-10-08T00:00:00Z',
      timeZone: 'Asia/Shanghai',
      weekStartsOn: 1,
    },
    now: '2026-10-08T00:00:00Z',
  });
  document.chapters = [
    {
      id: 'chapter',
      title: '成果',
      layout: 'content',
      hidden: false,
      locked: false,
      notes: 'PRIVATE-NOTES',
      nodes: [
        ReportNodeSchema.parse({
          id: 'image',
          type: 'image',
          assetId: 'private-image',
          alt: '交付',
          caption: '中文可搜索',
        }),
      ],
    },
  ];
  document.assets = [
    {
      id: 'private-image',
      blobKey: 'private-blob',
      mimeType: 'image/webp',
      alt: '交付',
    },
  ];
  const canvas = createCanvas(64, 32);
  canvas.getContext('2d').fillRect(0, 0, 64, 32);
  const webp = await canvas.encode('webp');
  const privateMetadata = Buffer.from(
    'PRIVATE-EXIF:/Users/internal/project/report.jpg\0'
  );
  const tiff = Buffer.alloc(26 + privateMetadata.length);
  tiff.write('II', 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x010e, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(privateMetadata.length, 14);
  tiff.writeUInt32LE(26, 18);
  privateMetadata.copy(tiff, 26);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const marker = Buffer.from([0xff, 0xe1, 0, 0]);
  marker.writeUInt16BE(exif.length + 2, 2);
  const jpeg = await canvas.encode('jpeg');
  const privateJpeg = Buffer.concat([
    jpeg.subarray(0, 2),
    marker,
    exif,
    jpeg.subarray(2),
  ]);
  assert(privateJpeg.includes(privateMetadata));
  const normalized = await normalizeProjectReportAsset({
    bytes: privateJpeg,
    mimeType: 'image/jpeg',
  });
  assert.equal(normalized.mimeType, 'image/png');
  assert.equal(normalized.width, 64);
  assert.equal(normalized.height, 32);
  assert(!normalized.bytes.includes(privateMetadata));
  assert(!normalized.bytes.includes(Buffer.from('Exif')));
  await assert.rejects(
    normalizeProjectReportAsset({
      bytes: Buffer.alloc(20 * 1024 * 1024 + 1),
      mimeType: 'image/png',
    }),
    /REPORT_ASSET_SIZE_LIMIT/
  );
  const dimensionBomb = Buffer.from(normalized.bytes);
  dimensionBomb.writeUInt32BE(1_000_000, 16);
  dimensionBomb.writeUInt32BE(1_000_000, 20);
  await assert.rejects(
    normalizeProjectReportAsset({ bytes: dimensionBomb, mimeType: 'image/png' })
  );
  // Archives and URL-shaped bytes are never expanded or fetched by asset decoding.
  await assert.rejects(
    normalizeProjectReportAsset({
      bytes: zipSync({ 'large.txt': new Uint8Array(10 * 1024 * 1024) }),
      mimeType: 'image/png',
    })
  );
  await assert.rejects(
    normalizeProjectReportAsset({
      bytes: Buffer.from('http://169.254.169.254/latest/meta-data/'),
      mimeType: 'image/png',
    })
  );
  await assert.rejects(
    normalizeProjectReportAsset(
      { bytes: normalized.bytes, mimeType: 'image/png' },
      1
    )
  );
  const audience = {
    kind: 'external' as const,
    chapterIds: ['chapter'],
    includeNotes: true,
    includeSources: false,
  };
  const assets = new Map([
    ['asset-1', { bytes: webp, mimeType: 'image/webp' }],
  ]);
  const result = await renderProjectReport({
    document,
    audience,
    assets,
    format: 'pptx',
  });
  const entries = unzipSync(result.bytes);
  assert(
    Object.keys(entries).some(path => /^ppt\/media\/image\d+\.png$/.test(path))
  );
  const text = Object.entries(entries)
    .filter(([path]) => path.endsWith('.xml'))
    .map(([, bytes]) => strFromU8(bytes))
    .join('');
  assert(!text.includes('PRIVATE-NOTES'));
  assert(!text.includes('private-creator'));
  assert(!text.includes('private-blob'));
  assert(result.compatibility.some(item => item.code === 'static_image'));
  await assert.rejects(
    renderProjectReport({
      document,
      audience,
      assets: new Map([['asset-1', { bytes: webp, mimeType: 'image/png' }]]),
      format: 'pdf',
    }),
    /REPORT_ASSET_MIME_MISMATCH/
  );
  await assert.rejects(
    renderProjectReport({
      document,
      audience,
      assets: new Map([
        ['unauthorized', { bytes: webp, mimeType: 'image/webp' }],
      ]),
      format: 'pdf',
    }),
    /REPORT_ASSET_PROJECTION_MISMATCH/
  );
  await assert.rejects(
    renderProjectReport({
      document,
      audience,
      assets: new Map([
        [
          'asset-1',
          {
            bytes: Buffer.from('<svg><script>bad()</script></svg>'),
            mimeType: 'image/svg+xml',
          },
        ],
      ]),
      format: 'pdf',
    })
  );
  console.log(
    'project-report-export: WebP decode, EXIF removal, PNG normalization, external projection and asset rejection passed'
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
