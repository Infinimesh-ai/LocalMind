import {
  captureOfficeSelection,
  type OfficeSelectionBookmark,
  type OfficeTextRange,
  resolveOfficeTextPosition,
  resolveOfficeTextRange,
  restoreOfficeSelection,
} from '@affine/core/modules/office';
import { diffTextReplacement } from '@affine/core/modules/office/docx-edit';
import {
  isEditableParagraph,
  paragraphGroups,
  replaceDocxRange,
} from '@affine/core/modules/office/docx-session';
import type { DocxParagraph, DocxRunFormat } from '@localmind/office/docx';
import {
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import type { useDocumentSession } from './use-document-session';

type Session = ReturnType<typeof useDocumentSession>;
export function useDocumentInput({
  rootRef,
  session,
  typingFormat,
  onError,
  bookmarkRef,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  session: Session;
  typingFormat: DocxRunFormat | null;
  onError: (e: unknown) => void;
  bookmarkRef: RefObject<OfficeSelectionBookmark | null>;
}) {
  const latest = useRef({ session, typingFormat, onError });
  latest.current = { session, typingFormat, onError };
  const paperPosition = useRef<{
    state: Session['state'];
    blockId: string;
    content: HTMLElement;
    x: number;
    y: number;
  } | null>(null);
  const composition = useRef<{
    p: DocxParagraph;
    bookmark: OfficeSelectionBookmark | null;
  } | null>(null);
  const range = useCallback((): OfficeTextRange | null => {
    const root = rootRef.current;
    if (!root) return null;
    const s = window.getSelection();
    const selected = resolveOfficeTextRange(root, s);
    if (selected) return selected;
    const pos = resolveOfficeTextPosition(root, s);
    return pos ? { type: 'text_range', start: pos, end: { ...pos } } : null;
  }, [rootRef]);
  const replace = useCallback(
    (text: string, soft = false, group = '', target = range()) => {
      const { session, typingFormat, onError } = latest.current;
      const root = rootRef.current;
      if (
        !root ||
        !target ||
        session.model.current.readOnly ||
        session.model.current.conflict
      )
        return;
      try {
        const before = captureOfficeSelection(root, window.getSelection());
        const next = replaceDocxRange(
          session.model.current.draft,
          target,
          text,
          typingFormat ?? undefined,
          soft
        );
        session.commit(next.state, next.bookmark, before, group);
        bookmarkRef.current = next.bookmark;
      } catch (e) {
        onError(e);
      }
    },
    [rootRef, range, bookmarkRef]
  );
  const remove = useCallback(
    (forward: boolean, word = false) => {
      const r = range();
      if (!r) return;
      if (
        r.start.blockId === r.end.blockId &&
        r.start.offset === r.end.offset
      ) {
        const state = latest.current.session.model.current.draft;
        const group = paragraphGroups(state.body).find(g =>
          g.some(p => p.id === r.start.blockId)
        );
        if (!group) return;
        const index = group.findIndex(p => p.id === r.start.blockId),
          p = group[index] as DocxParagraph,
          pos = r.start.offset;
        if ((forward && pos === p.text.length) || (!forward && pos === 0)) {
          const adjacent = group[index + (forward ? 1 : -1)];
          if (adjacent?.type !== 'paragraph') return;
          if (forward) r.end = { blockId: adjacent.id, offset: 0 };
          else r.start = { blockId: adjacent.id, offset: adjacent.text.length };
        } else {
          const segments = [
            ...new Intl.Segmenter(undefined, {
              granularity: word ? 'word' : 'grapheme',
            }).segment(p.text),
          ];
          if (forward) {
            const next = segments.find(s => s.index + s.segment.length > pos);
            if (next) r.end.offset = next.index + next.segment.length;
          } else
            r.start.offset = segments.findLast(s => s.index < pos)?.index ?? 0;
        }
      }
      replace('', false, '', r);
    },
    [range, replace]
  );
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const beforeInput = (event: InputEvent) => {
      if (
        latest.current.session.model.current.readOnly ||
        latest.current.session.model.current.conflict
      ) {
        event.preventDefault();
        return;
      }
      if (event.isComposing || composition.current) return;
      const type = event.inputType;
      if (type === 'insertText' || type === 'insertReplacementText') {
        event.preventDefault();
        replace(event.data ?? '', true, 'typing');
      } else if (type === 'insertParagraph' || type === 'insertLineBreak') {
        event.preventDefault();
        replace('\n', type === 'insertLineBreak');
      } else if (type.startsWith('delete')) {
        event.preventDefault();
        remove(type.includes('Forward'), type.includes('Word'));
      } else if (type === 'historyUndo' || type === 'historyRedo') {
        event.preventDefault();
        latest.current.session.history(
          type === 'historyRedo',
          captureOfficeSelection(root, window.getSelection())
        );
      }
    };
    const paste = (event: ClipboardEvent) => {
      if (!range()) return;
      event.preventDefault();
      replace(event.clipboardData?.getData('text/plain') ?? '');
    };
    const cut = (event: ClipboardEvent) => {
      const selected = resolveOfficeTextRange(root, window.getSelection());
      if (!selected) return;
      event.preventDefault();
      event.clipboardData?.setData(
        'text/plain',
        window.getSelection()?.toString() ?? ''
      );
      replace('', false, '', selected);
    };
    const start = () => {
      const r = range();
      const p =
        r &&
        paragraphGroups(latest.current.session.model.current.draft.body)
          .flat()
          .find(p => p.id === r.start.blockId);
      if (p?.type === 'paragraph') {
        composition.current = {
          p: structuredClone(p),
          bookmark: captureOfficeSelection(root, window.getSelection()),
        };
        latest.current.session.composition(true);
      }
    };
    const reconcile = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return;
      const element = target.closest<HTMLElement>('[data-office-block-id]');
      if (!element) return;
      const p =
        composition.current?.p ??
        paragraphGroups(latest.current.session.model.current.draft.body)
          .flat()
          .find(p => p.id === element.dataset.officeBlockId);
      if (p?.type !== 'paragraph') return;
      const diff = diffTextReplacement(p.text, element.textContent ?? '');
      if (!diff) return;
      replace(diff.text, true, 'typing', {
        type: 'text_range',
        start: { blockId: p.id, offset: diff.start },
        end: { blockId: p.id, offset: diff.end },
      });
    };
    const end = (e: CompositionEvent) => {
      reconcile(e.target);
      composition.current = null;
      latest.current.session.composition(false);
    };
    const input = (e: Event) => {
      if (!composition.current) reconcile(e.target);
    };
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || composition.current) return;
      const s = latest.current.session;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const all = paragraphGroups(s.model.current.draft.body)
          .flat()
          .filter((p): p is DocxParagraph => p.type === 'paragraph');
        const first = all[0],
          last = all.at(-1);
        if (first && last) {
          e.preventDefault();
          restoreOfficeSelection(root, {
            anchor: { blockId: first.id, offset: 0 },
            focus: { blockId: last.id, offset: last.text.length },
          });
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        s.history(
          e.shiftKey,
          captureOfficeSelection(root, window.getSelection())
        );
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.history(true, captureOfficeSelection(root, window.getSelection()));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        replace('\n', e.shiftKey);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        remove(e.key === 'Delete', e.altKey || e.ctrlKey);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        replace('\t', true);
        return;
      }
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
        return;
      const r = range();
      if (
        !r ||
        r.start.blockId !== r.end.blockId ||
        r.start.offset !== r.end.offset
      )
        return;
      const blocks = paragraphGroups(s.model.current.draft.body)
        .flat()
        .filter((b): b is DocxParagraph => b.type === 'paragraph');
      const i = blocks.findIndex(p => p.id === r.start.blockId);
      if (i < 0) return;
      const p = blocks[i],
        forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      const element = root.querySelector<HTMLElement>(
        `[data-office-block-id="${CSS.escape(p.id)}"]`
      );
      const selection = window.getSelection();
      const rect = selection?.rangeCount
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
      const line = element
        ? parseFloat(getComputedStyle(element).lineHeight) || 18
        : 18;
      const box = element?.getBoundingClientRect();
      const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      const edge = vertical
        ? rect &&
          box &&
          (forward
            ? rect.bottom >= box.bottom - line / 2
            : rect.top <= box.top + line / 2)
        : forward
          ? r.start.offset === p.text.length
          : r.start.offset === 0;
      const next = blocks[i + (forward ? 1 : -1)];
      if (!edge || !next) return;
      e.preventDefault();
      const position = {
        blockId: next.id,
        offset: vertical
          ? Math.min(r.start.offset, next.text.length)
          : forward
            ? 0
            : next.text.length,
      };
      restoreOfficeSelection(root, { anchor: position, focus: position });
    };
    // Native HTML drag/drop can move DOM outside the document transaction.
    const preventDrop = (event: DragEvent) => event.preventDefault();
    root.addEventListener('dragstart', preventDrop);
    root.addEventListener('drop', preventDrop);
    root.addEventListener('beforeinput', beforeInput);
    root.addEventListener('paste', paste);
    root.addEventListener('cut', cut);
    root.addEventListener('compositionstart', start);
    root.addEventListener('compositionend', end);
    root.addEventListener('input', input);
    root.addEventListener('keydown', key);
    return () => {
      root.removeEventListener('dragstart', preventDrop);
      root.removeEventListener('drop', preventDrop);
      root.removeEventListener('beforeinput', beforeInput);
      root.removeEventListener('paste', paste);
      root.removeEventListener('cut', cut);
      root.removeEventListener('compositionstart', start);
      root.removeEventListener('compositionend', end);
      root.removeEventListener('input', input);
      root.removeEventListener('keydown', key);
    };
  }, [rootRef, range, replace, remove]);
  useLayoutEffect(() => {
    if (session.restore && rootRef.current) {
      restoreOfficeSelection(rootRef.current, session.restore);
      bookmarkRef.current = session.restore;
      session.setRestore(null);
    }
  }, [session.state, session.restore, rootRef, bookmarkRef, session]);
  // Blank-space positioning is stored as real paragraphs and a first-line
  // indent, so it survives saving and stays in the same undo transaction.
  function paperMouseDown(event: MouseEvent) {
    const twice = event.detail === 2;
    if (
      event.button !== 0 ||
      event.detail > 2 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      !(event.target instanceof HTMLElement) ||
      !event.target.closest('[data-office-page-content]')
    )
      return;
    const content = event.target.closest<HTMLElement>(
      '[data-office-page-content]'
    );
    const root = rootRef.current;
    if (
      !content ||
      !root ||
      latest.current.session.model.current.readOnly ||
      latest.current.session.model.current.conflict ||
      latest.current.session.model.current.composing
    )
      return;
    const contentBox = content.getBoundingClientRect();
    const contentStyle = getComputedStyle(content);
    const scale = content.offsetWidth
      ? contentBox.width / content.offsetWidth
      : 1;
    const left =
      contentBox.left + (parseFloat(contentStyle.paddingLeft) || 0) * scale;
    const right =
      contentBox.right - (parseFloat(contentStyle.paddingRight) || 0) * scale;
    const top =
      contentBox.top + (parseFloat(contentStyle.paddingTop) || 0) * scale;
    const bottom =
      contentBox.bottom - (parseFloat(contentStyle.paddingBottom) || 0) * scale;
    if (
      scale <= 0 ||
      right <= left ||
      event.clientX < left ||
      event.clientX > right ||
      event.clientY < top ||
      event.clientY > bottom
    )
      return;
    const { session, onError } = latest.current;
    const previous = paperPosition.current;
    const amendment =
      twice &&
      event.detail === 2 &&
      previous?.state === session.model.current.draft &&
      previous.content === content &&
      Math.abs(previous.x - event.clientX) <= 4 &&
      Math.abs(previous.y - event.clientY) <= 4
        ? previous
        : null;
    // The first click can create a paragraph and change the second click's DOM
    // target. Refine that same paragraph instead of inserting another line.
    const clicked = amendment
      ? Array.from(
          content.querySelectorAll<HTMLElement>('[data-office-block-id]')
        ).find(element => element.dataset.officeBlockId === amendment.blockId)
      : event.target.closest<HTMLElement>('[data-office-block-id]');
    const element = clicked ?? content.lastElementChild;
    // Only direct body paragraphs participate; tables and content controls keep
    // their own selection behavior, including when they end the page.
    if (
      !(element instanceof HTMLElement) ||
      element.parentElement !== content ||
      element.getAttribute('contenteditable') !== 'true'
    )
      return;
    const p = session.model.current.draft.body.find(
      p => p.id === element.dataset.officeBlockId
    );
    if (
      p?.type !== 'paragraph' ||
      !isEditableParagraph(p) ||
      (clicked && p.text.length)
    )
      return;
    const rect = element.getBoundingClientRect();
    if (!clicked && event.clientY < rect.bottom) return;
    const pos = { blockId: p.id, offset: p.text.length };
    try {
      const before = captureOfficeSelection(root, window.getSelection());
      const style = getComputedStyle(element);
      const pitch =
        (parseFloat(style.lineHeight) || 18) +
        (parseFloat(style.marginBottom) || 0);
      const lines = clicked
        ? 0
        : Math.min(
            200,
            Math.max(
              1,
              Math.round((event.clientY - rect.bottom) / (pitch * scale))
            )
          );
      const next = replaceDocxRange(
        session.model.current.draft,
        {
          type: 'text_range',
          start: pos,
          end: pos,
        },
        '\n'.repeat(lines)
      );
      const destination = next.state.body.find(
        p => p.id === next.bookmark.focus.blockId
      );
      if (destination?.type !== 'paragraph') return;
      // CSS pixels -> points, rounded to the OOXML twip precision. A first-line
      // indent leaves wrapped lines at the normal body margin.
      destination.properties = {
        ...destination.properties,
        alignment: 'left',
        indent: {
          leftPt: 0,
          rightPt: 0,
          firstLinePt: twice
            ? Math.round(((event.clientX - left) / scale) * 15) / 20
            : 0,
        },
      };
      // Cancel native caret placement before it can paint at the old alignment.
      // The layout effect restores the final caret in the same render frame.
      event.preventDefault();
      if (
        !lines &&
        JSON.stringify(p.properties) === JSON.stringify(destination.properties)
      ) {
        restoreOfficeSelection(root, next.bookmark);
        paperPosition.current = null;
        return;
      }
      session.commit(next.state, next.bookmark, before, '', amendment?.state);
      bookmarkRef.current = next.bookmark;
      paperPosition.current = twice
        ? null
        : {
            state: next.state,
            blockId: destination.id,
            content,
            x: event.clientX,
            y: event.clientY,
          };
    } catch (e) {
      onError(e);
    }
  }
  return { paperMouseDown };
}
