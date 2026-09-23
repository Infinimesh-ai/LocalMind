import { I18n } from '@affine/i18n';
import type { OfficeSelection } from '@localmind/office';

export function officeSelectionLabel(selection: OfficeSelection) {
  switch (selection.kind) {
    case 'document': {
      const target = selection.target;
      if (target.type === 'text_range') {
        return target.start.blockId === target.end.blockId
          ? I18n['com.affine.office.text-range']({
              name: target.start.blockId,
              start: String(target.start.offset),
              end: String(target.end.offset),
            })
          : I18n['com.affine.office.text-span']({
              start: target.start.blockId,
              end: target.end.blockId,
            });
      }
      if (target.type === 'section')
        return I18n['com.affine.office.section-number']({
          number: String(target.sectionIndex + 1),
        });
      if (target.type === 'run') {
        return I18n['com.affine.office.run-number']({
          number: String(target.runIndex + 1),
          name: target.blockId,
        });
      }
      return I18n['com.affine.office.paragraph-name']({ name: target.blockId });
    }
    case 'workbook': {
      const target = selection.target;
      if (target.type === 'cell') return `${target.sheetId} ${target.address}`;
      if (target.type === 'cell_range')
        return `${target.sheetId} ${target.range}`;
      if (target.type === 'table')
        return I18n['com.affine.office.table-name']({ name: target.tableId });
      if (target.type === 'chart')
        return I18n['com.affine.office.chart-name']({ name: target.chartId });
      return I18n['com.affine.office.sheet-name']({ name: target.sheetId });
    }
    case 'presentation': {
      const target = selection.target;
      if (target.type === 'shape' || target.type === 'placeholder') {
        return `${target.slideId} / ${target.shapeId}`;
      }
      if (target.type === 'notes')
        return I18n['com.affine.office.slide-notes']({ name: target.slideId });
      return I18n['com.affine.office.slide-name']({ name: target.slideId });
    }
    case 'pdf': {
      const target = selection.target;
      if (target.type === 'form_field')
        return I18n['com.affine.office.named-form-field']({
          name: target.fieldName,
        });
      if (target.type === 'annotation') {
        return I18n['com.affine.office.page-annotation']({
          number: String(target.pageIndex + 1),
          name: target.annotationId,
        });
      }
      if (target.type === 'page_region') {
        return I18n['com.affine.office.page-region']({
          number: String(target.pageIndex + 1),
        });
      }
      return I18n['com.affine.office.page-number']({
        number: String(target.pageIndex + 1),
      });
    }
  }
}
