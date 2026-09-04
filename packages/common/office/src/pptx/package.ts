import { type OoxmlPackageOptions, openOoxmlPackage } from '../ooxml';

export const PPTX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const PPTX_PRESENTATION_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';

export type PptxPackageOptions = Omit<
  OoxmlPackageOptions,
  'format' | 'expectedMainContentType'
>;

export function openPptxPackage(
  input: Uint8Array,
  options: PptxPackageOptions = {}
) {
  return openOoxmlPackage(input, {
    ...options,
    format: 'pptx',
    expectedMainContentType: PPTX_PRESENTATION_CONTENT_TYPE,
  });
}
