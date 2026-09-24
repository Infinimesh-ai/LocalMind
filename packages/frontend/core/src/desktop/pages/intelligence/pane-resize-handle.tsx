import { useCallback, useEffect, useRef, useState } from 'react';

import * as styles from './index.css';

type PaneResizeHandleProps = {
  label: string;
  testId: string;
  direction?: 1 | -1;
  getWidth?: () => number;
  getBounds: () => { min: number; max: number };
  onChange: (width: number) => void;
  onReset: () => void;
};

export const PaneResizeHandle = ({
  label,
  testId,
  direction = 1,
  getWidth,
  getBounds,
  onChange,
  onReset,
}: PaneResizeHandleProps) => {
  const handleRef = useRef<HTMLDivElement>(null);
  const getWidthRef = useRef(getWidth);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const previousBodyStyle = useRef<{
    cursor: string;
    userSelect: string;
  } | null>(null);
  const [observedWidth, setObservedWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    getWidthRef.current = getWidth;
  }, [getWidth]);
  const readWidth = useCallback(
    () =>
      getWidthRef.current?.() ??
      handleRef.current?.parentElement?.getBoundingClientRect().width ??
      0,
    []
  );

  useEffect(() => {
    const pane = handleRef.current?.parentElement;
    if (!pane) return;
    const observeWidth = () => setObservedWidth(readWidth());
    observeWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(observeWidth);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [readWidth]);

  useEffect(
    () => () => {
      if (previousBodyStyle.current) {
        document.body.style.cursor = previousBodyStyle.current.cursor;
        document.body.style.userSelect = previousBodyStyle.current.userSelect;
      }
    },
    []
  );

  const finishDrag = () => {
    dragRef.current = null;
    setDragging(false);
    if (previousBodyStyle.current) {
      document.body.style.cursor = previousBodyStyle.current.cursor;
      document.body.style.userSelect = previousBodyStyle.current.userSelect;
      previousBodyStyle.current = null;
    }
  };

  const applyWidth = (width: number) => {
    const { min, max } = getBounds();
    onChange(Math.round(Math.max(min, Math.min(max, width))));
  };

  const bounds = getBounds();

  return (
    <div
      ref={handleRef}
      className={styles.paneResizeHandle}
      data-testid={testId}
      data-dragging={dragging}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={observedWidth ? Math.round(observedWidth) : undefined}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        if (!handleRef.current?.parentElement) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: readWidth(),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        previousBodyStyle.current = {
          cursor: document.body.style.cursor,
          userSelect: document.body.style.userSelect,
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        setDragging(true);
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        applyWidth(drag.startWidth + direction * (event.clientX - drag.startX));
      }}
      onPointerUp={event => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        finishDrag();
      }}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onKeyDown={event => {
        const step = event.shiftKey ? 40 : 16;
        const currentWidth = readWidth() || observedWidth;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          applyWidth(
            currentWidth +
              direction * (event.key === 'ArrowRight' ? step : -step)
          );
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          applyWidth(event.key === 'Home' ? bounds.min : bounds.max);
        }
      }}
      onDoubleClick={onReset}
    />
  );
};
