import { useI18n } from '@affine/i18n';
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';

import type { GraphRect } from './collaboration-graph-camera';
import type { Relation } from './collaboration-graph-model';
import * as styles from './collaboration-orbit.css';
import { orbitStatusLabel } from './collaboration-orbit-labels';
import {
  type OrderCardLayout,
  orderDirection,
} from './collaboration-orbit-model';
import {
  ORDER_ENTER_MS,
  ORDER_EXIT_MS,
  ORDER_LAUNCH_GAP_MS,
  ORDER_TITLE_OFFSET,
  orderMotionFrames,
} from './collaboration-orbit-motion';

type OpenOrder = (order: Relation, anchor: HTMLButtonElement) => void;

export function CollaborationOrbitOrders({
  layout,
  node,
  closing,
  openId,
  detailPinned,
  onReady,
  onClosed,
  onOpen,
  onPreview,
  onPreviewLeave,
  reveal,
}: {
  layout: OrderCardLayout | null;
  node: { x: number; y: number; diameter: number };
  closing: boolean;
  openId: string | null;
  detailPinned: boolean;
  onReady: () => void;
  onClosed: () => void;
  onOpen: OpenOrder;
  onPreview: OpenOrder;
  onPreviewLeave: () => void;
  reveal: (rect: GraphRect) => void;
}) {
  const t = useI18n();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const animations = useRef<Animation[]>([]);
  const started = useRef(false);
  const generation = useRef(0);
  const callbacks = useRef({ onReady, onClosed });
  callbacks.current = { onReady, onClosed };
  const [phase, setPhase] = useState<'entering' | 'ready' | 'exiting'>(
    'entering'
  );
  const [landedOrders, setLandedOrders] = useState<Set<string>>(
    () => new Set()
  );
  // Pinning, previewing, or updating a title must never replay the entrance.
  const signature = JSON.stringify([
    layout?.side,
    node.x,
    node.y,
    node.diameter,
    layout?.cards.map(c => [c.order.id, c.x, c.y]),
  ]);

  useLayoutEffect(() => {
    const token = ++generation.current;
    const snapshot = new Map(
      [...buttons.current].map(([id, button]) => [
        id,
        window.getComputedStyle(button),
      ])
    );
    // Read computed values before cancelling an interrupted orbit.
    const current = new Map(
      [...snapshot].map(([id, style]) => [
        id,
        {
          transform: style.transform,
          width: style.width,
          height: style.height,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          opacity: style.opacity,
          backgroundColor: style.backgroundColor,
        },
      ])
    );
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    const fullEntrance = !started.current;
    started.current = true;
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const finish = () => {
      if (token !== generation.current) return;
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
      setPhase(closing ? 'exiting' : 'ready');
      if (closing) callbacks.current.onClosed();
      else callbacks.current.onReady();
    };
    setPhase(closing ? 'exiting' : 'entering');
    setLandedOrders(new Set());
    layout?.cards.forEach((card, index) => {
      const button = buttons.current.get(card.order.id);
      if (!button?.animate) return;
      const duration = closing
        ? ORDER_EXIT_MS
        : fullEntrance && !reduced
          ? ORDER_ENTER_MS
          : 150;
      const delay =
        !closing && fullEntrance && !reduced ? index * ORDER_LAUNCH_GAP_MS : 0;
      const frames: Keyframe[] = closing
        ? [
            current.get(card.order.id) ?? {},
            {
              transform: reduced
                ? 'none'
                : `translate(${(node.x - card.x - card.width / 2) * 0.12}px, ${(node.y - card.y - card.height / 2) * 0.12}px)`,
              opacity: 0,
            },
          ]
        : fullEntrance && !reduced
          ? orderMotionFrames(layout, node, index)
          : [{ opacity: 0.35 }, { opacity: 1 }];
      const cardAnimations = [
        button.animate(frames, {
          duration,
          delay,
          fill: 'both',
          easing: closing ? 'ease-out' : 'linear',
        }),
      ];
      const content = button.querySelector(`.${styles.cardContent}`);
      if (!closing && content?.animate)
        cardAnimations.push(
          content.animate(
            [
              { opacity: 0, offset: 0 },
              {
                opacity: 0,
                offset: fullEntrance && !reduced ? ORDER_TITLE_OFFSET : 0.1,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
              },
              { opacity: 1, offset: 1 },
            ],
            { duration, delay, fill: 'both' }
          )
        );
      animations.current.push(...cardAnimations);
      // Finished capsules are usable while later balls are still in flight.
      if (!closing)
        void Promise.all(
          cardAnimations.map(animation =>
            animation.finished.catch(() => undefined)
          )
        )
          .then(() => {
            if (token !== generation.current) return;
            cardAnimations.forEach(animation => animation.cancel());
            setLandedOrders(current => new Set([...current, card.order.id]));
          })
          .catch(() => {});
    });
    if (!animations.current.length) finish();
    else
      void Promise.all(
        animations.current.map(animation =>
          animation.finished.catch(() => undefined)
        )
      )
        .then(finish)
        .catch(() => {});
    // The signature deliberately contains only geometry and identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, closing]);

  useLayoutEffect(
    () => () => {
      generation.current++;
      animations.current.forEach(animation => animation.cancel());
      // React StrictMode replays mount effects in development.
      started.current = false;
    },
    []
  );

  return layout?.cards.map(card => (
    <button
      key={card.order.id}
      ref={button => {
        if (button) buttons.current.set(card.order.id, button);
        else buttons.current.delete(card.order.id);
      }}
      type="button"
      className={styles.orderCard}
      data-order-trigger
      data-order-id={card.order.id}
      data-side={layout.side}
      data-direction={orderDirection(card.order)}
      data-active={openId === card.order.id}
      data-detail-pinned={openId === card.order.id && detailPinned}
      data-phase={
        closing ? 'exiting' : landedOrders.has(card.order.id) ? 'ready' : phase
      }
      disabled={
        closing || (phase !== 'ready' && !landedOrders.has(card.order.id))
      }
      aria-label={`${orderDirection(card.order) === 'incoming' ? `${card.order.otherName} → ${t['com.affine.localmind.workbench.v9.graphSelf']()}` : `${t['com.affine.localmind.workbench.v9.graphSelf']()} → ${card.order.otherName}`} · ${card.order.label} · ${orbitStatusLabel(card.order.status, card.order.side, t)}`}
      aria-haspopup="dialog"
      aria-expanded={openId === card.order.id}
      style={
        {
          left: card.x - node.x,
          top: card.y - node.y,
          width: card.width,
          height: card.height,
        } as CSSProperties
      }
      onFocus={event => {
        if (event.currentTarget.matches(':focus-visible')) reveal(card);
      }}
      onPointerEnter={event => {
        if (event.pointerType === 'mouse')
          onPreview(card.order, event.currentTarget);
      }}
      onPointerLeave={onPreviewLeave}
      onBlur={onPreviewLeave}
      onClick={event => onOpen(card.order, event.currentTarget)}
    >
      <span className={styles.cardContent}>
        <i aria-hidden="true" />
        <strong>{card.order.label}</strong>
      </span>
    </button>
  ));
}
