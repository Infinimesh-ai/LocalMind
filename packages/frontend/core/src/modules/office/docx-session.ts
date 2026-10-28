import {
  isStableDocxParagraphId,
  type OfficeDocumentEditCommand,
  type OfficeDocumentEditParagraph,
  type OfficeDocumentFormatTextCommand,
} from '@localmind/office';
import type {
  DocxBlock,
  DocxParagraph,
  DocxRun,
  DocxRunFormat,
  DocxSemanticState,
} from '@localmind/office/docx';

import type { OfficeTextRange } from './types';

export function paragraphId(used: ReadonlySet<string> = new Set()) {
  let id: string;
  do {
    const value = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
    id = `paragraph:${value.toString(16).padStart(8, '0').toUpperCase()}`;
  } while (!isStableDocxParagraphId(id) || used.has(id));
  return id;
}
export function paragraphGroups(blocks: DocxBlock[]): DocxBlock[][] {
  return [
    blocks,
    ...blocks.flatMap(b =>
      b.type === 'table'
        ? b.rows.flatMap(r => r.cells.flatMap(c => paragraphGroups(c.blocks)))
        : b.type === 'contentControl'
          ? paragraphGroups(b.blocks)
          : []
    ),
  ];
}
export function prepareDocxEditing(state: DocxSemanticState) {
  const normalized = structuredClone(state);
  const identities: OfficeDocumentEditCommand['identities'] = [];
  const used = new Set(
    paragraphGroups(normalized.body).flatMap(g => g.map(p => p.id))
  );
  for (const group of paragraphGroups(normalized.body))
    for (const p of group)
      if (p.type === 'paragraph' && !isStableDocxParagraphId(p.id)) {
        const id = paragraphId(used);
        used.add(id);
        identities.push({ blockId: p.id, id });
        p.id = id;
        p.sourceId = id.slice(10);
      }
  for (const values of Object.values(normalized.references))
    for (const reference of values) {
      const mapped = identities.find(i => i.blockId === reference.paragraphId);
      if (mapped) reference.paragraphId = mapped.id;
    }
  return { state: normalized, identities };
}
export function isEditableParagraph(p: DocxParagraph) {
  return (
    p.editingSupported !== false &&
    !p.fields.length &&
    !p.bookmarks.length &&
    p.runs.every(
      r =>
        !r.change &&
        !r.hyperlinkRelationshipId &&
        r.content.every(
          c =>
            c.type === 'text' ||
            c.type === 'tab' ||
            (c.type === 'break' &&
              (!c.breakType ||
                c.breakType === 'textWrapping' ||
                c.breakType === 'page'))
        )
    )
  );
}
export function runText(run: DocxRun) {
  return run.content
    .map(c =>
      c.type === 'text'
        ? c.text
        : c.type === 'tab'
          ? '\t'
          : c.type === 'break'
            ? c.breakType === 'page'
              ? '\f'
              : '\n'
            : ''
    )
    .join('');
}
function runsSlice(runs: DocxRun[], from: number, to: number) {
  let offset = 0;
  return runs.flatMap(run => {
    const text = runText(run);
    const start = Math.max(0, from - offset),
      end = Math.min(text.length, to - offset);
    offset += text.length;
    return end > start
      ? [
          {
            ...run,
            content: [{ type: 'text' as const, text: text.slice(start, end) }],
          },
        ]
      : [];
  });
}
function compactRuns(runs: DocxRun[]): DocxRun[] {
  const result: DocxRun[] = [];
  for (const run of runs) {
    const previous = result.at(-1);
    if (
      previous &&
      JSON.stringify(previous.format) === JSON.stringify(run.format)
    ) {
      previous.content = [
        { type: 'text', text: runText(previous) + runText(run) },
      ];
    } else result.push({ ...run });
  }
  return result;
}
function rangeGroup(state: DocxSemanticState, range: OfficeTextRange) {
  const group = paragraphGroups(state.body).find(g =>
    g.some(p => p.id === range.start.blockId)
  );
  const start = group?.findIndex(p => p.id === range.start.blockId) ?? -1;
  const end = group?.findIndex(p => p.id === range.end.blockId) ?? -1;
  if (
    range.start.offset < 0 ||
    range.end.offset < 0 ||
    (start === end && range.end.offset < range.start.offset) ||
    !group ||
    start < 0 ||
    end < start ||
    group
      .slice(start, end + 1)
      .some(p => p.type !== 'paragraph' || !isEditableParagraph(p))
  )
    throw new Error('unsupported-edit');
  const first = group[start] as DocxParagraph,
    last = group[end] as DocxParagraph;
  if (
    range.start.offset > first.text.length ||
    range.end.offset > last.text.length
  )
    throw new Error('invalid-selection');
  return { group, start, end, first, last };
}
export function replaceDocxRange(
  state: DocxSemanticState,
  range: OfficeTextRange,
  text: string,
  format?: DocxRunFormat,
  softBreak = false
) {
  const next = structuredClone(state);
  const { group, start, end, first, last } = rangeGroup(next, range);
  const pieces = softBreak ? [text] : text.replace(/\r\n?/g, '\n').split('\n');
  const prefix = runsSlice(first.runs, 0, range.start.offset),
    suffix = runsSlice(last.runs, range.end.offset, last.text.length);
  const inherited = format ?? formatAt(first, range.start.offset);
  const usedIds = new Set(
    paragraphGroups(next.body)
      .flat()
      .map(p => p.id)
  );
  const replacement = pieces.map((piece, index) => {
    const runs = compactRuns([
      ...(index === 0 ? prefix : []),
      ...(piece
        ? [
            {
              content: [{ type: 'text' as const, text: piece }],
              format: inherited,
            },
          ]
        : []),
      ...(index === pieces.length - 1 ? suffix : []),
    ]);
    const id = index === 0 ? first.id : paragraphId(usedIds);
    usedIds.add(id);
    return {
      ...first,
      id,
      sourceId: id.slice(10),
      runs: runs.length
        ? runs
        : [
            {
              content: [{ type: 'text' as const, text: '' }],
              format: inherited,
            },
          ],
      text: runs.map(runText).join(''),
      fields: [],
      bookmarks: [],
    };
  });
  group.splice(start, end - start + 1, ...replacement);
  const position = {
    blockId: replacement[replacement.length - 1].id,
    offset:
      (pieces.length === 1 ? range.start.offset : 0) +
      pieces[pieces.length - 1].length,
  };
  return { state: next, bookmark: { anchor: position, focus: position } };
}
export function formatAt(p: DocxParagraph, offset: number): DocxRunFormat {
  let cursor = 0;
  for (const run of p.runs) {
    cursor += runText(run).length;
    if (cursor >= offset) return run.format ?? {};
  }
  return p.runs.at(-1)?.format ?? {};
}
export function formatDocxRange(
  state: DocxSemanticState,
  range: OfficeTextRange,
  format: OfficeDocumentFormatTextCommand['format']
) {
  const next = structuredClone(state);
  const { group, start, end } = rangeGroup(next, range);
  for (let i = start; i <= end; i++) {
    const p = group[i] as DocxParagraph;
    if (format.paragraphStyleId !== undefined)
      p.properties = { ...p.properties, styleId: format.paragraphStyleId };
    const from = i === start ? range.start.offset : 0,
      to = i === end ? range.end.offset : p.text.length;
    p.runs = compactRuns([
      ...runsSlice(p.runs, 0, from),
      ...runsSlice(p.runs, from, to).map(run => ({
        ...run,
        format: mergeTypingFormat(run.format ?? {}, format),
      })),
      ...runsSlice(p.runs, to, p.text.length),
    ]);
  }
  return next;
}
export function mergeTypingFormat(
  current: DocxRunFormat,
  format: OfficeDocumentFormatTextCommand['format']
): DocxRunFormat {
  const { paragraphStyleId: _style, textColor, ...rest } = format;
  const next = {
    ...current,
    ...rest,
    ...(textColor ? { color: textColor, themeColor: undefined } : {}),
  };
  if (format.fontFamily) next.fonts = undefined;
  return next;
}
function descriptor(p: DocxParagraph): OfficeDocumentEditParagraph {
  return {
    id: p.id,
    properties: p.properties as OfficeDocumentEditParagraph['properties'],
    runs: p.runs.map(r => ({ text: runText(r), format: r.format })),
  };
}
export function docxEditPatches(
  before: DocxSemanticState,
  after: DocxSemanticState
): OfficeDocumentEditCommand['patches'] {
  const patches: OfficeDocumentEditCommand['patches'] = [];
  function compare(a: DocxBlock[], b: DocxBlock[]) {
    let ai = 0,
      bi = 0;
    while (ai < a.length || bi < b.length) {
      const aa: DocxParagraph[] = [],
        bb: DocxParagraph[] = [];
      while (
        a[ai]?.type === 'paragraph' &&
        isEditableParagraph(a[ai] as DocxParagraph)
      )
        aa.push(a[ai++] as DocxParagraph);
      while (
        b[bi]?.type === 'paragraph' &&
        isEditableParagraph(b[bi] as DocxParagraph)
      )
        bb.push(b[bi++] as DocxParagraph);
      let left = 0;
      while (
        left < aa.length &&
        left < bb.length &&
        JSON.stringify(aa[left]) === JSON.stringify(bb[left])
      )
        left++;
      let ae = aa.length,
        be = bb.length;
      while (
        ae > left &&
        be > left &&
        JSON.stringify(aa[ae - 1]) === JSON.stringify(bb[be - 1])
      ) {
        ae--;
        be--;
      }
      if (left !== ae || left !== be) {
        if (left === ae) {
          if (left > 0) left--;
          else {
            ae++;
            be++;
          }
        }
        if (!aa.length) throw new Error('unsupported-edit');
        const targets = aa.slice(left, ae);
        if (targets.some(p => !isEditableParagraph(p)))
          throw new Error('unsupported-edit');
        patches.push({
          targets: targets.map(p => p.id),
          paragraphs: bb.slice(left, be).map(descriptor),
        });
      }
      if (ai === a.length && bi === b.length) break;
      const ab = a[ai++],
        bc = b[bi++];
      if (!ab || !bc || ab.id !== bc.id || ab.type !== bc.type)
        throw new Error('unsupported-edit');
      if (ab.type === 'paragraph' && JSON.stringify(ab) !== JSON.stringify(bc))
        throw new Error('unsupported-edit');
      if (ab.type === 'table' && bc.type === 'table')
        ab.rows.forEach((r, ri) =>
          r.cells.forEach((c, ci) =>
            compare(c.blocks, bc.rows[ri].cells[ci].blocks)
          )
        );
      if (ab.type === 'contentControl' && bc.type === 'contentControl')
        compare(ab.blocks, bc.blocks);
    }
  }
  compare(before.body, after.body);
  return patches;
}
