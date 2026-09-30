import { Avatar } from '@affine/component';
import { useI18n } from '@affine/i18n';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { MAX_GRAPH_ZOOM } from './collaboration-graph-camera';
import type { Relation } from './collaboration-graph-model';
import * as styles from './collaboration-orbit.css';
import { CollaborationOrbitLine } from './collaboration-orbit-line';
import {
  type buildOrbitModel,
  deliveryPath,
  type Direction,
  isWithinOrderExpansion,
  layoutOrbit,
  layoutOrderCards,
  ordersFor,
} from './collaboration-orbit-model';
import { CollaborationOrbitOrders } from './collaboration-orbit-orders';
import { useCollaborationGraphCamera } from './use-collaboration-graph-camera';

type Model = ReturnType<typeof buildOrbitModel>;
type OpenOrder = (order: Relation, anchor: HTMLButtonElement) => void;

export function CollaborationOrbit({
  model,
  includeHistory,
  openId,
  detailPinned,
  onOpen,
  onPreview,
  onPreviewLeave,
  onDismiss,
}: {
  model: Model;
  includeHistory: boolean;
  openId: string | null;
  detailPinned: boolean;
  onOpen: OpenOrder;
  onPreview: OpenOrder;
  onPreviewLeave: () => void;
  onDismiss: () => void;
}) {
  const t = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [closing, setClosing] = useState(false);
  const [readyPerson, setReadyPerson] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('all');
  const [historyOrders, setHistoryOrders] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 800, height: 620 });
  const [measured, setMeasured] = useState(false);
  const pendingSelection = useRef<{ id: string; pinned: boolean } | null>(null);
  const hoverOpenTimer = useRef<number | undefined>(undefined);
  const hoverCloseTimer = useRef<number | undefined>(undefined);
  const overAvatar = useRef<string | null>(null);
  const overExpansion = useRef(false);
  const overCorridor = useRef(false);
  const personButtons = useRef(new Map<string, HTMLButtonElement>());
  const linesRef = useRef<SVGSVGElement>(null);
  const fitted = useRef(false);
  const slots = useRef(new Map<string, number>());
  const radius = useRef(380);
  const lastReveal = useRef('');
  const hoverState = useRef({ pinned, selected, openId, detailPinned });
  hoverState.current = { pinned, selected, openId, detailPinned };
  const clearHoverTimers = useCallback(() => {
    window.clearTimeout(hoverOpenTimer.current);
    window.clearTimeout(hoverCloseTimer.current);
  }, []);
  useEffect(() => clearHoverTimers, [clearHoverTimers]);

  const layout = useMemo(
    () => layoutOrbit(model.people, slots.current, radius.current),
    [model.people]
  );
  useLayoutEffect(() => {
    slots.current = layout.slots;
    radius.current = layout.radiusX;
  }, [layout]);
  const visible = layout.nodes.filter(
    item => includeHistory || item.person.active.length > 0
  );
  const node = visible.find(item => item.person.id === selected);
  const person = node?.person;
  const orders = useMemo(
    () =>
      person
        ? ordersFor(person, direction, historyOrders || !person.active.length)
        : [],
    [person, direction, historyOrders]
  );
  const cardLayout = useMemo(
    () => (node ? layoutOrderCards(layout.self, node, orders) : null),
    [layout.self, node, orders]
  );
  const sceneBounds = useMemo(() => {
    const rectangles = layout.nodes.flatMap(item => {
      const active = layoutOrderCards(layout.self, item, item.person.active);
      const history = layoutOrderCards(layout.self, item, item.person.history);
      return [active?.rect, history?.rect].filter(
        (rect): rect is NonNullable<typeof rect> => !!rect
      );
    });
    const halfWidth = Math.max(
      layout.width / 2,
      ...rectangles.flatMap(rect => [
        layout.self.x - rect.x + 24,
        rect.x + rect.width - layout.self.x + 24,
      ])
    );
    const halfHeight = Math.max(
      layout.height - layout.self.y,
      layout.self.y,
      ...rectangles.flatMap(rect => [
        layout.self.y - rect.y + 24,
        rect.y + rect.height - layout.self.y + 24,
      ])
    );
    return {
      left: layout.self.x - halfWidth,
      top: layout.self.y - halfHeight,
      width: halfWidth * 2,
      height: halfHeight * 2,
    };
  }, [layout]);
  const viewport = useCollaborationGraphCamera(
    size.width,
    size.height,
    sceneBounds.width,
    sceneBounds.height
  );
  const { host, reveal, setView } = viewport;
  const sceneTransform = `${viewport.transform} translate(${-sceneBounds.left}px, ${-sceneBounds.top}px)`;

  useLayoutEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (!rect?.width || !rect.height) return;
      setSize(current =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height }
      );
      setMeasured(true);
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [host]);
  useLayoutEffect(() => {
    if (!measured || fitted.current) return;
    fitted.current = true;
    setView({
      x: layout.self.x - sceneBounds.left,
      y: layout.self.y - sceneBounds.top,
      zoom: Math.min(
        1,
        size.width / (layout.radiusX * 2 + 180),
        size.height / (layout.radiusY * 2 + 220)
      ),
    });
  }, [layout, measured, sceneBounds.left, sceneBounds.top, setView, size]);
  useLayoutEffect(() => {
    window.dispatchEvent(new Event('relationship-view-change'));
  }, [viewport.camera.x, viewport.camera.y, viewport.camera.zoom, size]);
  useEffect(() => {
    if (!selected || node) return;
    clearHoverTimers();
    setSelected(null);
    setPinned(false);
    setClosing(false);
    onDismiss();
  }, [clearHoverTimers, node, onDismiss, selected]);

  const finishClosing = () => {
    const next = pendingSelection.current;
    pendingSelection.current = null;
    setSelected(next?.id ?? null);
    setPinned(next?.pinned ?? false);
    setDirection('all');
    setHistoryOrders(false);
    setReadyPerson(null);
    setClosing(false);
  };
  const close = useCallback(() => {
    clearHoverTimers();
    pendingSelection.current = null;
    setPinned(false);
    onDismiss();
    setClosing(!!selected);
  }, [clearHoverTimers, onDismiss, selected]);
  const choose = (id: string, nextPinned: boolean) => {
    clearHoverTimers();
    onDismiss();
    if (selected && selected !== id) {
      pendingSelection.current = { id, pinned: nextPinned };
      setClosing(true);
    } else {
      if (selected !== id) {
        setDirection('all');
        setHistoryOrders(false);
        setReadyPerson(null);
      }
      setSelected(id);
      setPinned(nextPinned);
      setClosing(false);
    }
  };
  const scheduleClose = useCallback(() => {
    window.clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = window.setTimeout(() => {
      const state = hoverState.current;
      if (
        state.pinned ||
        state.detailPinned ||
        state.openId ||
        overAvatar.current ||
        overExpansion.current ||
        overCorridor.current
      )
        return;
      close();
    }, 450);
  }, [close]);
  useEffect(() => {
    if (detailPinned) setPinned(true);
    if (openId) window.clearTimeout(hoverCloseTimer.current);
    else if (
      selected &&
      !pinned &&
      !overAvatar.current &&
      !overExpansion.current &&
      !overCorridor.current
    )
      scheduleClose();
  }, [detailPinned, openId, pinned, scheduleClose, selected]);
  useEffect(() => {
    if (!node || !cardLayout || closing) return;
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const bounds = host.current?.getBoundingClientRect();
      if (!bounds) return;
      const other =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-person-id]')?.dataset
              .personId
          : undefined;
      const inside =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom &&
        (!other || other === selected) &&
        isWithinOrderExpansion(cardLayout, node, {
          x:
            sceneBounds.left +
            viewport.camera.x +
            (event.clientX - bounds.left - size.width / 2) /
              viewport.camera.zoom,
          y:
            sceneBounds.top +
            viewport.camera.y +
            (event.clientY - bounds.top - size.height / 2) /
              viewport.camera.zoom,
        });
      const wasInside = overCorridor.current;
      overCorridor.current = inside;
      if (inside) window.clearTimeout(hoverCloseTimer.current);
      else if (wasInside) scheduleClose();
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [
    cardLayout,
    closing,
    host,
    node,
    sceneBounds,
    scheduleClose,
    selected,
    size,
    viewport.camera,
  ]);
  useEffect(() => {
    const svg = linesRef.current;
    const element = host.current;
    if (!svg || !element) return;
    let inView = true;
    const sync = () => {
      if (document.hidden || !inView) svg.pauseAnimations?.();
      else svg.unpauseAnimations?.();
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            sync();
          });
    observer?.observe(element);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [host]);
  useLayoutEffect(() => {
    const signature = `${selected}:${pinned}:${direction}:${readyPerson}`;
    if (lastReveal.current === signature) return;
    lastReveal.current = signature;
    if (!node || !pinned || closing || openId || readyPerson !== selected)
      return;
    const rect = layoutOrderCards(layout.self, node, orders.slice(0, 5))?.rect;
    if (rect)
      reveal({
        x: rect.x - sceneBounds.left,
        y: rect.y - sceneBounds.top,
        width: rect.width,
        height: rect.height,
      });
  }, [
    selected,
    pinned,
    direction,
    readyPerson,
    node,
    closing,
    openId,
    orders,
    layout.self,
    reveal,
    sceneBounds,
  ]);
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openId) return;
      close();
      personButtons.current.get(selected)?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, openId, selected]);

  const id = useId().replaceAll(':', '');
  const highlighted = hovered ?? selected;
  return (
    <div className={styles.world}>
      <div
        className={styles.legend}
        aria-label={t['com.affine.localmind.workbench.orbit.directions']()}
      >
        <span data-direction="incoming">
          ● {t['com.affine.localmind.workbench.orbit.incoming']()}{' '}
          <b>{model.incoming}</b>
        </span>
        <span data-direction="outgoing">
          ● {t['com.affine.localmind.workbench.orbit.outgoing']()}{' '}
          <b>{model.outgoing}</b>
        </span>
      </div>
      <div
        ref={host}
        className={styles.viewport}
        tabIndex={0}
        role="region"
        aria-label={t['com.affine.localmind.workbench.orbit.title']()}
        {...viewport.handlers}
        onClick={event => {
          if (
            event.target instanceof Element &&
            !event.target.closest('button, input, [data-orbit-expansion]')
          )
            close();
        }}
      >
        <div
          className={styles.canvas}
          data-finite-canvas="true"
          style={{
            width: layout.width,
            height: layout.height,
            transform: sceneTransform,
          }}
        >
          <svg
            ref={linesRef}
            className={styles.lines}
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={`${id}-flow-fade`}>
                <stop offset="0" stopColor="white" stopOpacity="0" />
                <stop offset="0.14" stopColor="white" stopOpacity="0.08" />
                <stop offset="0.32" stopColor="white" stopOpacity="0.52" />
                <stop offset="0.5" stopColor="white" stopOpacity="1" />
                <stop offset="0.68" stopColor="white" stopOpacity="0.52" />
                <stop offset="0.86" stopColor="white" stopOpacity="0.08" />
                <stop offset="1" stopColor="white" stopOpacity="0" />
              </linearGradient>
            </defs>
            {visible.map((item, index) => (
              <g
                key={item.person.id}
                data-highlighted={highlighted === item.person.id}
                data-dimmed={!!highlighted && highlighted !== item.person.id}
                className={styles.connection}
              >
                {!item.person.active.length && (
                  <path
                    className={styles.deliveryTrack}
                    d={deliveryPath(layout.self, item, true, false)}
                    strokeWidth={1 / viewport.camera.zoom}
                  />
                )}
                {(['incoming', 'outgoing'] as const)
                  .filter(tone => item.person[tone] > 0)
                  .map(tone => (
                    <CollaborationOrbitLine
                      key={tone}
                      self={layout.self}
                      node={item}
                      direction={tone}
                      both={
                        item.person.incoming > 0 && item.person.outgoing > 0
                      }
                      phase={index * 0.71 + (tone === 'outgoing' ? 0.45 : 0)}
                      gradientId={`${id}-flow-fade`}
                      zoom={viewport.camera.zoom}
                    />
                  ))}
              </g>
            ))}
          </svg>
          <div
            className={styles.self}
            style={{ left: layout.self.x, top: layout.self.y }}
          >
            <Avatar
              size={112}
              name={
                model.self?.label ??
                t['com.affine.localmind.workbench.v9.graphSelf']()
              }
              url={model.self?.avatarUrl}
            />
            <strong>
              {t['com.affine.localmind.workbench.v9.graphSelf']()}
            </strong>
            <small>
              {t['com.affine.localmind.workbench.orbit.activeCount']({
                count: String(model.activeCount),
              })}
            </small>
          </div>
          {visible.map(item => {
            const peer = item.person;
            return (
              <button
                key={peer.id}
                ref={element => {
                  if (element) personButtons.current.set(peer.id, element);
                  else personButtons.current.delete(peer.id);
                }}
                type="button"
                className={styles.person}
                data-person-id={peer.id}
                data-selected={selected === peer.id}
                data-dimmed={!!selected && selected !== peer.id}
                aria-expanded={selected === peer.id}
                aria-controls={
                  selected === peer.id ? `${id}-orders` : undefined
                }
                aria-label={t[
                  'com.affine.localmind.workbench.orbit.personSummary'
                ]({
                  name: peer.name,
                  orders: String(peer.active.length),
                  incoming: String(peer.incoming),
                  outgoing: String(peer.outgoing),
                })}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.diameter,
                  height: item.diameter,
                }}
                onClick={() => {
                  if (selected === peer.id && pinned && !closing) close();
                  else choose(peer.id, true);
                }}
                onPointerEnter={event => {
                  if (event.pointerType !== 'mouse') return;
                  overAvatar.current = peer.id;
                  setHovered(peer.id);
                  clearHoverTimers();
                  if (selected === peer.id || pinned || detailPinned) return;
                  hoverOpenTimer.current = window.setTimeout(() => {
                    if (
                      overAvatar.current === peer.id &&
                      !hoverState.current.pinned &&
                      !hoverState.current.detailPinned &&
                      personButtons.current.get(peer.id)?.isConnected
                    )
                      choose(peer.id, false);
                  }, 140);
                }}
                onPointerLeave={event => {
                  if (event.pointerType !== 'mouse') return;
                  overAvatar.current = null;
                  setHovered(null);
                  window.clearTimeout(hoverOpenTimer.current);
                  scheduleClose();
                }}
                onFocus={event => {
                  if (event.currentTarget.matches(':focus-visible'))
                    reveal({
                      x: item.x - sceneBounds.left - 75,
                      y: item.y - sceneBounds.top - 75,
                      width: 150,
                      height: 150,
                    });
                }}
              >
                <Avatar
                  size={item.diameter}
                  name={peer.name}
                  url={peer.avatarUrl}
                />
                <span
                  className={styles.avatarRing}
                  data-both={peer.incoming > 0 && peer.outgoing > 0}
                />
                <span className={styles.personCaption}>
                  <strong>{peer.name}</strong>
                  <small>
                    {t['com.affine.localmind.workbench.orbit.activeCount']({
                      count: String(peer.active.length),
                    })}
                  </small>
                </span>
              </button>
            );
          })}
          {node && person && (
            <div
              id={`${id}-orders`}
              key={person.id}
              data-orbit-expansion
              className={styles.expansion}
              style={
                {
                  left: node.x,
                  top: node.y,
                  '--controls-top': `${node.diameter / 2 + 66}px`,
                } as CSSProperties
              }
              onPointerEnter={event => {
                if (event.pointerType !== 'mouse') return;
                overExpansion.current = true;
                window.clearTimeout(hoverCloseTimer.current);
              }}
              onPointerLeave={event => {
                if (event.pointerType !== 'mouse') return;
                overExpansion.current = false;
                scheduleClose();
              }}
              onFocusCapture={() => setPinned(true)}
            >
              <CollaborationOrbitOrders
                layout={cardLayout}
                node={node}
                closing={closing}
                openId={openId}
                detailPinned={detailPinned}
                onReady={() => setReadyPerson(person.id)}
                onClosed={finishClosing}
                onOpen={(order, anchor) => {
                  setPinned(true);
                  onOpen(order, anchor);
                }}
                onPreview={onPreview}
                onPreviewLeave={onPreviewLeave}
                reveal={rect =>
                  reveal({
                    x: rect.x - sceneBounds.left,
                    y: rect.y - sceneBounds.top,
                    width: rect.width,
                    height: rect.height,
                  })
                }
              />
              <div className={styles.personControls}>
                <div className={styles.directionFilters}>
                  <button
                    type="button"
                    data-direction="incoming"
                    aria-pressed={direction === 'incoming'}
                    onClick={() => {
                      setPinned(true);
                      setDirection(value =>
                        value === 'incoming' ? 'all' : 'incoming'
                      );
                    }}
                  >
                    {t['com.affine.localmind.workbench.orbit.incoming']()}{' '}
                    {person.incoming}
                  </button>
                  <button
                    type="button"
                    data-direction="outgoing"
                    aria-pressed={direction === 'outgoing'}
                    onClick={() => {
                      setPinned(true);
                      setDirection(value =>
                        value === 'outgoing' ? 'all' : 'outgoing'
                      );
                    }}
                  >
                    {t['com.affine.localmind.workbench.orbit.outgoing']()}{' '}
                    {person.outgoing}
                  </button>
                  {person.history.length > 0 && (
                    <button
                      type="button"
                      aria-pressed={historyOrders}
                      onClick={() => {
                        setPinned(true);
                        setHistoryOrders(value => !value);
                      }}
                    >
                      {t['com.affine.localmind.workbench.orbit.historyCount']({
                        count: String(person.history.length),
                      })}
                    </button>
                  )}
                </div>
                {!orders.length && (
                  <small>
                    {t['com.affine.localmind.workbench.orbit.noOrders']()}
                  </small>
                )}
              </div>
            </div>
          )}
          {!visible.length && (
            <div
              className={styles.empty}
              style={{ left: layout.self.x, top: layout.self.y + 145 }}
            >
              {model.drafts.length
                ? t['com.affine.localmind.workbench.orbit.draftHint']()
                : t['com.affine.localmind.workbench.orbit.empty']()}
            </div>
          )}
        </div>
      </div>
      <div
        className={styles.camera}
        role="group"
        aria-label={t['com.affine.localmind.workbench.orbit.camera']()}
      >
        <button
          type="button"
          aria-label={t['com.affine.localmind.workbench.orbit.zoomOut']()}
          disabled={viewport.camera.zoom <= viewport.minZoom + 0.001}
          onClick={() => viewport.zoomBy(1 / 1.2)}
        >
          −
        </button>
        <button
          type="button"
          aria-label={t['com.affine.localmind.workbench.orbit.zoomReset']()}
          onClick={() => viewport.zoomTo(1)}
        >
          {Math.round(viewport.camera.zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label={t['com.affine.localmind.workbench.orbit.zoomIn']()}
          disabled={viewport.camera.zoom >= MAX_GRAPH_ZOOM - 0.001}
          onClick={() => viewport.zoomBy(1.2)}
        >
          +
        </button>
        <button type="button" onClick={viewport.fit}>
          {t['com.affine.localmind.workbench.orbit.fit']()}
        </button>
      </div>
    </div>
  );
}
