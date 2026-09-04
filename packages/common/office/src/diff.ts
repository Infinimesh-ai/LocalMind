import type { DocxBlock, DocxSemanticState } from './docx';
import type { PdfSemanticState } from './pdf';
import type { PptxSemanticState, PptxShape } from './pptx';
import type { XlsxSemanticState } from './xlsx';

export const OFFICE_REVISION_DIFF_VERSION = 'localmind-office-revision-diff/v1';

export type OfficeSemanticKind =
  | 'document'
  | 'workbook'
  | 'presentation'
  | 'pdf';

export type OfficeSemanticState =
  | DocxSemanticState
  | XlsxSemanticState
  | PptxSemanticState
  | PdfSemanticState;

export type OfficeRevisionDiffChange = {
  entity: string;
  id: string;
  change: 'added' | 'removed' | 'modified';
  label: string;
  changedFields?: string[];
  before?: string;
  after?: string;
};

export type OfficeRevisionDiff = {
  version: typeof OFFICE_REVISION_DIFF_VERSION;
  kind: OfficeSemanticKind;
  changed: boolean;
  truncated: boolean;
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    entitiesExamined: number;
    returnedChanges: number;
  };
  changes: OfficeRevisionDiffChange[];
};

type ComparableEntity = {
  entity: string;
  id: string;
  label: string;
  value: Record<string, unknown>;
  preview?: string;
};

const SCHEMA_BY_KIND = {
  document: 'localmind-office-docx-state/v1',
  workbook: 'localmind-office-xlsx-state/v1',
  presentation: 'localmind-office-pptx-state/v1',
  pdf: 'localmind-office-pdf-state/v1',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertState(
  kind: OfficeSemanticKind,
  value: unknown
): asserts value is OfficeSemanticState {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_BY_KIND[kind]) {
    throw new Error(`Office ${kind} semantic state is invalid`);
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])])
  );
}

function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function boundedPreview(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 320 ? `${normalized.slice(0, 319)}…` : normalized;
}

function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => stableJson(before[key]) !== stableJson(after[key]))
    .sort()
    .slice(0, 64);
}

function entity(
  kind: string,
  id: string,
  label: string,
  value: Record<string, unknown>,
  preview?: string
): ComparableEntity {
  return { entity: kind, id, label, value, preview: boundedPreview(preview) };
}

function collectDocxBlocks(
  blocks: readonly DocxBlock[],
  output: ComparableEntity[]
) {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      output.push(
        entity(
          'paragraph',
          block.id,
          block.text || 'Empty paragraph',
          {
            text: block.text,
            properties: block.properties,
            runs: block.runs.map(run => ({
              format: run.format,
              change: run.change,
              content: run.content,
            })),
            fields: block.fields,
            bookmarks: block.bookmarks,
          },
          block.text
        )
      );
    } else if (block.type === 'table') {
      output.push(
        entity('table', block.id, 'Table', {
          styleId: block.styleId,
          widthTwips: block.widthTwips,
          layout: block.layout,
          rows: block.rows.length,
          columns: Math.max(0, ...block.rows.map(row => row.cells.length)),
        })
      );
      for (const row of block.rows) {
        for (const cell of row.cells) collectDocxBlocks(cell.blocks, output);
      }
    } else if (block.type === 'contentControl') {
      output.push(
        entity(
          'contentControl',
          block.id,
          block.title ?? block.tag ?? 'Content control',
          { title: block.title, tag: block.tag }
        )
      );
      collectDocxBlocks(block.blocks, output);
    } else {
      output.push(
        entity('unsupportedBlock', block.id, block.element, {
          element: block.element,
        })
      );
    }
  }
}

function documentEntities(state: DocxSemanticState) {
  const output: ComparableEntity[] = [];
  collectDocxBlocks(state.body, output);
  state.sections.forEach(section =>
    output.push(
      entity('section', String(section.index), `Section ${section.index + 1}`, {
        ...section,
      })
    )
  );
  state.stories.forEach(story => {
    const paragraphs: ComparableEntity[] = [];
    collectDocxBlocks(story.blocks, paragraphs);
    output.push(
      entity(
        'story',
        `${story.kind}:${story.type ?? 'default'}:${story.part}`,
        `${story.type ?? 'default'} ${story.kind}`,
        {
          kind: story.kind,
          type: story.type,
          part: story.part,
          blocks: paragraphs.map(item => item.value),
        },
        paragraphs
          .map(item => item.preview)
          .filter(Boolean)
          .join(' ')
      )
    );
  });
  state.review.comments.forEach(comment =>
    output.push(
      entity(
        'nativeComment',
        comment.id,
        comment.author ?? 'Comment',
        {
          ...comment,
        },
        comment.text
      )
    )
  );
  output.push(
    entity('documentSettings', 'settings', 'Document settings', {
      trackRevisions: state.review.trackRevisions,
      protection: state.review.protection,
      styles: state.styles,
      references: state.references,
    })
  );
  return output;
}

function workbookEntities(state: XlsxSemanticState) {
  const output: ComparableEntity[] = [
    entity('workbook', 'workbook', 'Workbook', {
      activeSheetIndex: state.activeSheetIndex,
      definedNames: state.definedNames,
      styles: state.styles,
    }),
  ];
  for (const sheet of state.sheets) {
    output.push(
      entity('worksheet', sheet.id, sheet.name, {
        name: sheet.name,
        state: sheet.state,
        dimension: sheet.dimension,
        rows: sheet.rows,
        columns: sheet.columns,
        mergedCells: sheet.mergedCells,
        frozenPane: sheet.frozenPane,
        autoFilter: sheet.autoFilter,
      })
    );
    sheet.cells.forEach(cell =>
      output.push(
        entity(
          'cell',
          `${sheet.id}:${cell.address}`,
          `${sheet.name}!${cell.address}`,
          { ...cell },
          cell.formula ? `=${cell.formula}` : String(cell.value ?? '')
        )
      )
    );
    sheet.dataValidations.forEach((validation, index) =>
      output.push(
        entity(
          'dataValidation',
          `${sheet.id}:${validation.range}:${index}`,
          `${sheet.name}!${validation.range}`,
          { ...validation }
        )
      )
    );
    sheet.tables.forEach(table =>
      output.push(
        entity('table', `${sheet.id}:${table.id}`, table.displayName, {
          ...table,
        })
      )
    );
    sheet.charts.forEach(chart =>
      output.push(
        entity('chart', `${sheet.id}:${chart.id}`, chart.title ?? chart.type, {
          ...chart,
        })
      )
    );
  }
  return output;
}

function collectPptxShapes(
  slideId: string,
  shapes: readonly PptxShape[],
  output: ComparableEntity[]
) {
  for (const shape of shapes) {
    output.push(
      entity(
        'shape',
        `${slideId}:${shape.id}`,
        shape.name ?? shape.text ?? `${shape.type} ${shape.id}`,
        { ...shape, children: undefined },
        shape.text
      )
    );
    if (shape.children) collectPptxShapes(slideId, shape.children, output);
  }
}

function presentationEntities(state: PptxSemanticState) {
  const output: ComparableEntity[] = [
    entity('presentation', 'presentation', 'Presentation', {
      slideSize: state.slideSize,
      notesSize: state.notesSize,
      masterOrder: state.masters.map(master => master.id),
    }),
  ];
  state.slides.forEach((slide, index) => {
    output.push(
      entity(
        'slide',
        slide.id,
        slide.name || `Slide ${index + 1}`,
        {
          index,
          name: slide.name,
          hidden: slide.hidden,
          layoutPart: slide.layoutPart,
          notesText: slide.notesText,
          hasTiming: slide.hasTiming,
          commentParts: slide.commentParts,
        },
        slide.notesText
      )
    );
    collectPptxShapes(slide.id, slide.shapes, output);
  });
  state.masters.forEach(master =>
    output.push(
      entity('slideMaster', master.id, master.part, {
        themePart: master.themePart,
        themeColors: master.themeColors,
        layoutParts: master.layoutParts,
      })
    )
  );
  return output;
}

function pdfEntities(state: PdfSemanticState) {
  const output: ComparableEntity[] = [
    entity('pdfMetadata', 'metadata', 'PDF metadata', {
      pdfVersion: state.pdfVersion,
      metadata: state.metadata,
    }),
  ];
  state.pages.forEach((page, index) => {
    output.push(
      entity('page', page.id, `Page ${index + 1}`, {
        index,
        widthPt: page.widthPt,
        heightPt: page.heightPt,
        rotationDeg: page.rotationDeg,
      })
    );
    page.annotations.forEach(annotation =>
      output.push(
        entity(
          'annotation',
          `${page.id}:${annotation.id}`,
          `${annotation.subtype} annotation`,
          { ...annotation },
          annotation.contents
        )
      )
    );
  });
  state.formFields.forEach(field =>
    output.push(
      entity(
        'formField',
        field.name,
        field.name,
        { ...field },
        String(field.value ?? '')
      )
    )
  );
  return output;
}

function entitiesFor(kind: OfficeSemanticKind, state: OfficeSemanticState) {
  switch (kind) {
    case 'document':
      return documentEntities(state as DocxSemanticState);
    case 'workbook':
      return workbookEntities(state as XlsxSemanticState);
    case 'presentation':
      return presentationEntities(state as PptxSemanticState);
    case 'pdf':
      return pdfEntities(state as PdfSemanticState);
  }
}

export function diffOfficeSemanticStates(
  kind: OfficeSemanticKind,
  beforeInput: unknown,
  afterInput: unknown,
  options: { maxChanges?: number } = {}
): OfficeRevisionDiff {
  assertState(kind, beforeInput);
  assertState(kind, afterInput);
  const maxChanges = Math.max(1, Math.min(2_000, options.maxChanges ?? 250));
  const before = new Map(
    entitiesFor(kind, beforeInput).map(item => [
      `${item.entity}:${item.id}`,
      item,
    ])
  );
  const after = new Map(
    entitiesFor(kind, afterInput).map(item => [
      `${item.entity}:${item.id}`,
      item,
    ])
  );
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: OfficeRevisionDiffChange[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;

  for (const key of keys) {
    const previous = before.get(key);
    const next = after.get(key);
    let change: OfficeRevisionDiffChange | undefined;
    if (!previous && next) {
      added++;
      change = {
        entity: next.entity,
        id: next.id,
        change: 'added',
        label: next.label,
        after: next.preview,
      };
    } else if (previous && !next) {
      removed++;
      change = {
        entity: previous.entity,
        id: previous.id,
        change: 'removed',
        label: previous.label,
        before: previous.preview,
      };
    } else if (
      previous &&
      next &&
      stableJson(previous.value) !== stableJson(next.value)
    ) {
      modified++;
      change = {
        entity: next.entity,
        id: next.id,
        change: 'modified',
        label: next.label,
        changedFields: changedFields(previous.value, next.value),
        before: previous.preview,
        after: next.preview,
      };
    } else {
      unchanged++;
    }
    if (change && changes.length < maxChanges) changes.push(change);
  }

  const totalChanges = added + removed + modified;
  return {
    version: OFFICE_REVISION_DIFF_VERSION,
    kind,
    changed: totalChanges > 0,
    truncated: totalChanges > changes.length,
    summary: {
      added,
      removed,
      modified,
      unchanged,
      entitiesExamined: keys.length,
      returnedChanges: changes.length,
    },
    changes,
  };
}
