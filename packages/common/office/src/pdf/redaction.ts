import {
  PDFAcroTerminal,
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  type PDFObject,
  type PDFPage,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

import { PdfPackageError } from './package';

export function detachRedactedPageObjects(
  document: PDFDocument,
  page: PDFPage
) {
  if (
    document.catalog.getAcroForm()?.dict.has(PDFName.of('XFA')) ||
    document.catalog.has(PDFName.of('StructTreeRoot'))
  ) {
    throw new PdfPackageError(
      'PDF redaction does not yet support XFA or tagged document structures'
    );
  }
  const form = document.getForm();
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  if (
    media.x !== 0 ||
    media.y !== 0 ||
    crop.x !== 0 ||
    crop.y !== 0 ||
    crop.width !== media.width ||
    crop.height !== media.height
  ) {
    throw new PdfPackageError(
      'PDF redaction requires an uncropped page with a zero-origin media box'
    );
  }
  const annotations = page.node.Annots()?.asArray() ?? [];
  const dictionaries = new Set(
    annotations.map(item => document.context.lookup(item))
  );
  for (const other of document.getPages()) {
    if (other.ref === page.ref) continue;
    if (
      other.node
        .Annots()
        ?.asArray()
        .some(item => dictionaries.has(document.context.lookup(item)))
    ) {
      throw new PdfPackageError(
        'PDF redaction cannot remove annotations shared by multiple pages'
      );
    }
  }
  const removed = new Set<PDFRef>(
    annotations.filter((item): item is PDFRef => item instanceof PDFRef)
  );
  for (const [field] of form.acroForm.getAllFields()) {
    if (!(field instanceof PDFAcroTerminal)) continue;
    const widgets = field.getWidgets();
    const indexes = widgets.flatMap((widget, index) =>
      widget.P() === page.ref || dictionaries.has(widget.dict) ? [index] : []
    );
    if (!indexes.length) continue;
    for (const index of indexes) {
      const ref = document.context.getObjectRef(widgets[index].dict);
      if (ref) removed.add(ref);
    }
    if (indexes.length === widgets.length) {
      form.acroForm.removeField(field);
      form.markFieldAsClean(field.ref);
      removed.add(field.ref);
    } else {
      for (const index of indexes.reverse()) field.removeWidget(index);
    }
  }
  return removed;
}

/** Redirect page destinations and detach references to removed annotations. */
export function replaceRedactedPageReferences(
  document: PDFDocument,
  source: PDFRef,
  replacement: PDFRef,
  removed: ReadonlySet<PDFRef>
) {
  const pending: PDFObject[] = document.context
    .enumerateIndirectObjects()
    .map(([, value]) => value);
  const visited = new Set<PDFObject>();
  while (pending.length) {
    const object = pending.pop();
    if (!object) continue;
    if (visited.has(object)) continue;
    visited.add(object);
    if (object instanceof PDFStream) pending.push(object.dict);
    else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (value === source) object.set(key, replacement);
        else if (value instanceof PDFRef && removed.has(value))
          object.delete(key);
        else if (!(value instanceof PDFRef)) pending.push(value);
      }
    } else if (object instanceof PDFArray) {
      for (let index = object.size() - 1; index >= 0; index--) {
        const value = object.get(index);
        if (value === source) object.set(index, replacement);
        else if (value instanceof PDFRef && removed.has(value))
          object.remove(index);
        else if (!(value instanceof PDFRef)) pending.push(value);
      }
    }
  }
}

/** pdf-lib serializes unreachable objects too; remove them before redaction output. */
export function removeUnreachablePdfObjects(document: PDFDocument) {
  const pending: PDFObject[] = Object.values(
    document.context.trailerInfo
  ).filter((object): object is PDFObject => object !== undefined);
  const objects = new Set<PDFObject>();
  const references = new Set<PDFRef>();
  while (pending.length) {
    const object = pending.pop();
    if (!object) continue;
    if (object instanceof PDFRef) {
      if (references.has(object)) continue;
      references.add(object);
      const value = document.context.lookup(object);
      if (value) pending.push(value);
      continue;
    }
    if (objects.has(object)) continue;
    objects.add(object);
    if (object instanceof PDFStream) pending.push(object.dict);
    else if (object instanceof PDFDict) {
      for (const value of object.values()) pending.push(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) pending.push(value);
    }
  }
  for (const [reference] of document.context.enumerateIndirectObjects()) {
    if (!references.has(reference)) document.context.delete(reference);
  }
}
