import type { OfficeTextPosition, OfficeTextRange } from './types';

const PARAGRAPH_SELECTOR = '[data-office-block-id]';

export type OfficeSelectionBookmark = {
  anchor: OfficeTextPosition;
  focus: OfficeTextPosition;
};

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
}

function resolvePosition(
  root: HTMLElement,
  node: Node,
  offset: number
): (OfficeTextPosition & { order: number }) | null {
  const paragraph = elementOf(node)?.closest<HTMLElement>(PARAGRAPH_SELECTOR);
  if (!paragraph || !root.contains(paragraph)) return null;
  const blockId = paragraph.dataset.officeBlockId;
  const order = Number(paragraph.dataset.officeOrder);
  if (!blockId || !Number.isSafeInteger(order)) return null;

  const range = document.createRange();
  range.selectNodeContents(paragraph);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  const textOffset = range.toString().length;
  const base = Number(paragraph.dataset.officeFragmentOffset ?? 0);
  return {
    blockId,
    offset:
      base + Math.min(textOffset, paragraph.textContent?.length ?? textOffset),
    order,
  };
}

export function resolveOfficeTextPosition(
  root: HTMLElement,
  selection: Selection | null
): OfficeTextPosition | null {
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode) {
    return null;
  }
  const position = resolvePosition(
    root,
    selection.anchorNode,
    selection.anchorOffset
  );
  return position
    ? { blockId: position.blockId, offset: position.offset }
    : null;
}

export function resolveOfficeTextRange(
  root: HTMLElement,
  selection: Selection | null
): OfficeTextRange | null {
  if (
    !selection ||
    selection.rangeCount === 0 ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode
  ) {
    return null;
  }
  const anchor = resolvePosition(
    root,
    selection.anchorNode,
    selection.anchorOffset
  );
  const focus = resolvePosition(
    root,
    selection.focusNode,
    selection.focusOffset
  );
  if (!anchor || !focus) return null;
  const anchorFirst =
    anchor.order < focus.order ||
    (anchor.order === focus.order && anchor.offset <= focus.offset);
  const start = anchorFirst ? anchor : focus;
  const end = anchorFirst ? focus : anchor;
  if (start.blockId === end.blockId && start.offset === end.offset) return null;
  return {
    type: 'text_range',
    start: { blockId: start.blockId, offset: start.offset },
    end: { blockId: end.blockId, offset: end.offset },
  };
}

// DOM ranges point at nodes that are replaced when an immutable revision loads.
// Keep both endpoints in document coordinates, including the selection direction.
export function captureOfficeSelection(
  root: HTMLElement,
  selection: Selection | null
): OfficeSelectionBookmark | null {
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode) {
    return null;
  }
  const anchor = resolvePosition(
    root,
    selection.anchorNode,
    selection.anchorOffset
  );
  const focus = resolvePosition(
    root,
    selection.focusNode,
    selection.focusOffset
  );
  if (!anchor || !focus) return null;
  return {
    anchor: { blockId: anchor.blockId, offset: anchor.offset },
    focus: { blockId: focus.blockId, offset: focus.offset },
  };
}

function resolveDomPosition(root: HTMLElement, position: OfficeTextPosition) {
  const paragraphs = [
    ...root.querySelectorAll<HTMLElement>(
      `[data-office-block-id="${CSS.escape(position.blockId)}"]`
    ),
  ];
  const paragraph = paragraphs.find(p => {
    const base = Number(p.dataset.officeFragmentOffset ?? 0);
    return (
      position.offset >= base &&
      position.offset <= base + (p.textContent?.length ?? 0)
    );
  });
  if (
    !paragraph ||
    !Number.isSafeInteger(position.offset) ||
    position.offset < 0
  )
    return null;
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let remaining =
    position.offset - Number(paragraph.dataset.officeFragmentOffset ?? 0);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining, paragraph };
    remaining -= length;
  }
  // Empty paragraphs contain a <br> rather than a text node.
  return remaining === 0
    ? { node: paragraph, offset: paragraph.childNodes.length, paragraph }
    : null;
}

export function restoreOfficeSelection(
  root: HTMLElement,
  bookmark: OfficeSelectionBookmark
): boolean {
  const anchor = resolveDomPosition(root, bookmark.anchor);
  const focus = resolveDomPosition(root, bookmark.focus);
  const selection = window.getSelection();
  if (!anchor || !focus || !selection) return false;
  anchor.paragraph.focus({ preventScroll: true });
  selection.setBaseAndExtent(
    anchor.node,
    anchor.offset,
    focus.node,
    focus.offset
  );
  return true;
}
