import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  constrainGraphCamera,
  constrainGraphPosition,
  fitGraphZoom,
  type GraphBounds,
  type GraphCamera,
  type GraphRect,
  minGraphZoom,
  panGraphCamera,
  revealGraphRect,
} from './collaboration-graph-camera';

type Pointer = { x: number; y: number; startX: number; startY: number };
const distance = (points: Pointer[]) =>
  Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
const editable = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('input, textarea, select, [contenteditable="true"]');

export function useCollaborationGraphCamera(
  width: number,
  height: number,
  contentWidth: number,
  contentHeight: number
) {
  const host = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Pointer>());
  const space = useRef(false);
  const hovered = useRef(false);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const bounds = useMemo<GraphBounds>(
    () => ({ width, height, contentWidth, contentHeight }),
    [width, height, contentWidth, contentHeight]
  );
  const [storedCamera, setCamera] = useState<GraphCamera>({
    x: contentWidth / 2,
    y: contentHeight / 2,
    zoom: 1,
  });
  const camera = constrainGraphPosition(storedCamera, bounds);
  const update = useCallback(
    (change: (current: GraphCamera) => GraphCamera) => {
      setCamera(current =>
        constrainGraphPosition(
          change(constrainGraphPosition(current, bounds)),
          bounds
        )
      );
    },
    [bounds]
  );
  const zoomTo = useCallback(
    (zoom: number) =>
      update(current => constrainGraphCamera({ ...current, zoom }, bounds)),
    [bounds, update]
  );
  const zoomBy = useCallback(
    (factor: number) =>
      update(current =>
        constrainGraphCamera(
          { ...current, zoom: current.zoom * factor },
          bounds
        )
      ),
    [bounds, update]
  );
  const pan = useCallback(
    (dx: number, dy: number) =>
      update(current => panGraphCamera(current, dx, dy, bounds)),
    [bounds, update]
  );
  const reveal = useCallback(
    (rect: GraphRect) =>
      update(current => revealGraphRect(current, rect, bounds)),
    [bounds, update]
  );
  const fit = useCallback(
    () =>
      update(() => ({
        x: contentWidth / 2,
        y: contentHeight / 2,
        zoom: fitGraphZoom(bounds),
      })),
    [bounds, contentWidth, contentHeight, update]
  );

  const setView = useCallback(
    (next: GraphCamera) => setCamera(constrainGraphPosition(next, bounds)),
    [bounds]
  );
  useLayoutEffect(() => {
    setCamera(current => constrainGraphPosition(current, bounds));
  }, [bounds]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      if (event.ctrlKey || event.metaKey) {
        // Never anchor to the pointer: zoom changes only scale around the viewport centre.
        zoomBy(
          Math.exp(-Math.max(-200, Math.min(200, event.deltaY * unit)) * 0.004)
        );
      } else {
        pan(
          -(event.deltaX || (event.shiftKey ? event.deltaY : 0)) * unit,
          event.shiftKey ? 0 : -event.deltaY * unit
        );
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [height, pan, zoomBy]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || editable(event.target)) return;
      space.current = true;
      setSpaceHeld(true);
      if (event.target === host.current || hovered.current)
        event.preventDefault();
    };
    const release = () => {
      space.current = false;
      setSpaceHeld(false);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') release();
    };
    const blur = () => {
      release();
      pointers.current.clear();
      setDragging(false);
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!pointers.current.size) setDragging(false);
  };

  return {
    host,
    camera,
    setView,
    zoomTo,
    zoomBy,
    fit,
    reveal,
    minZoom: minGraphZoom(bounds),
    transform: `translate(${width / 2 - camera.x * camera.zoom}px, ${height / 2 - camera.y * camera.zoom}px) scale(${camera.zoom})`,
    handlers: {
      'data-panning': dragging,
      'data-pan-ready': spaceHeld,
      onPointerEnter: () => {
        hovered.current = true;
      },
      onPointerLeave: () => {
        hovered.current = false;
      },
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        const interactive =
          event.target instanceof Element &&
          !!event.target.closest('button, a, input');
        if (!pointers.current.size) suppressClick.current = false;
        if (interactive && !space.current && event.pointerType !== 'touch')
          return;
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
        });
        if (!interactive || space.current) {
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        const previous = pointers.current.get(event.pointerId);
        if (!previous) return;
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, {
          ...previous,
          x: event.clientX,
          y: event.clientY,
        });
        if (before.length > 1) {
          const oldDistance = distance(before);
          if (oldDistance > 0)
            zoomBy(distance([...pointers.current.values()]) / oldDistance);
        } else {
          if (
            Math.hypot(
              event.clientX - previous.startX,
              event.clientY - previous.startY
            ) < 5 &&
            !suppressClick.current
          )
            return;
          pan(event.clientX - previous.x, event.clientY - previous.y);
        }
        suppressClick.current = true;
        setDragging(true);
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
        // Touch capture may transfer from a summary to the viewport mid-gesture.
        if (event.target === event.currentTarget) endPointer(event);
      },
      onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
        if (!suppressClick.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (
          event.target !== event.currentTarget ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        switch (event.key) {
          case 'ArrowLeft':
            pan(80, 0);
            break;
          case 'ArrowRight':
            pan(-80, 0);
            break;
          case 'ArrowUp':
            pan(0, 80);
            break;
          case 'ArrowDown':
            pan(0, -80);
            break;
          case '+':
          case '=':
            zoomBy(1.2);
            break;
          case '-':
            zoomBy(1 / 1.2);
            break;
          case '0':
            zoomTo(1);
            break;
          case 'Home':
            fit();
            break;
          default:
            return;
        }
        event.preventDefault();
      },
    },
  };
}
