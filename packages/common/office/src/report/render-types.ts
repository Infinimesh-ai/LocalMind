import type { ReportProjection } from './audience';
export type ReportRenderAsset = {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
};
export type ReportRenderInput = {
  projection: ReportProjection;
  format: 'pdf' | 'pptx' | 'offline';
  assets: ReadonlyMap<string, ReportRenderAsset>;
  font: { bytes: Uint8Array; license: string };
};
export type ReportCompatibility = {
  code: string;
  message: string;
  nodeId?: string;
};
export const REPORT_RENDERER_VERSION = 'localmind-report-renderer/1';
export const escapeReportXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char] ?? char
  );
