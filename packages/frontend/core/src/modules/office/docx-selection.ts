import type { OfficeTextPosition, OfficeTextRange } from './types';

const PARAGRAPH_SELECTOR = '[data-office-block-id]';

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
  return {
    blockId,
    offset: Math.min(textOffset, paragraph.textContent?.length ?? textOffset),
    order,
  };
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
