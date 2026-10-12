import {
  captureOfficeSelection,
  type DocxSemanticState,
  type OfficeSelectionBookmark,
  paginateDocxBlocks,
} from '@affine/core/modules/office';
import {
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export function useDocumentLayout(
  state: DocxSemanticState,
  root: RefObject<HTMLDivElement | null>,
  restore: (selection: OfficeSelectionBookmark) => void
) {
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(
    new Map()
  );
  const measured = useRef(heights);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const next = new Map<string, number>();
      for (const block of element.querySelectorAll<HTMLElement>(
        '[data-office-layout-block]'
      )) {
        const style = getComputedStyle(block);
        const height =
          block.getBoundingClientRect().height +
          parseFloat(style.marginTop || '0') +
          parseFloat(style.marginBottom || '0');
        if (height > 0) next.set(block.dataset.officeLayoutBlock ?? '', height);
      }
      const previous = measured.current;
      if (
        next.size === previous.size &&
        [...next].every(
          ([id, h]) => Math.abs(h - (previous.get(id) ?? 0)) < 0.5
        )
      )
        return;
      const bookmark = captureOfficeSelection(element, window.getSelection());
      if (bookmark) restore(bookmark);
      measured.current = next;
      setHeights(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const block of element.querySelectorAll('[data-office-layout-block]'))
      observer.observe(block);
    return () => observer.disconnect();
  }, [state, root, restore]);
  return useMemo(
    () => paginateDocxBlocks(state.body, state.sections, heights),
    [state, heights]
  );
}
