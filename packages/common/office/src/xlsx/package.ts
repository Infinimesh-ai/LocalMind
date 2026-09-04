import { type OoxmlPackageOptions, openOoxmlPackage } from '../ooxml';

export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const XLSX_WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

export type XlsxPackageOptions = Omit<
  OoxmlPackageOptions,
  'format' | 'expectedMainContentType'
>;

export function openXlsxPackage(
  input: Uint8Array,
  options: XlsxPackageOptions = {}
) {
  return openOoxmlPackage(input, {
    ...options,
    format: 'xlsx',
    expectedMainContentType: XLSX_WORKBOOK_CONTENT_TYPE,
  });
}
