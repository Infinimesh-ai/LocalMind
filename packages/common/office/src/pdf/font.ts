import fontkit from '@pdf-lib/fontkit';
import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFStream,
} from 'pdf-lib';

/** Embed the bundled Unicode font without depending on the host's font setup. */
export async function createUnicodePdfFont(
  document: PDFDocument,
  bytes: Uint8Array
) {
  document.registerFontkit(fontkit);
  const font = await document.embedFont(bytes, { subset: false });
  const finalize = async () => {
    await font.embed();
    if (new TextDecoder('ascii').decode(bytes.slice(0, 4)) === 'OTTO') {
      // fontkit's CFF probe differs from pdf-lib's older probe. Correct only this
      // font's dictionaries; other embedded TrueType fonts must stay untouched.
      const dictionary = document.context.lookup(font.ref, PDFDict);
      const descendants = dictionary.lookup(
        PDFName.of('DescendantFonts'),
        PDFArray
      );
      const descendant = descendants.lookup(0, PDFDict);
      const descriptor = descendant.lookup(
        PDFName.of('FontDescriptor'),
        PDFDict
      );
      const file =
        descriptor.get(PDFName.of('FontFile2')) ??
        descriptor.get(PDFName.of('FontFile3'));
      if (file) {
        const stream = document.context.lookup(file);
        if (stream instanceof PDFStream)
          stream.dict.set(PDFName.of('Subtype'), PDFName.of('OpenType'));
        descriptor.delete(PDFName.of('FontFile2'));
        descriptor.set(PDFName.of('FontFile3'), file);
      }
      descendant.set(PDFName.of('Subtype'), PDFName.of('CIDFontType0'));
      descendant.delete(PDFName.of('CIDToGIDMap'));
    }
  };
  return { font, finalize };
}
