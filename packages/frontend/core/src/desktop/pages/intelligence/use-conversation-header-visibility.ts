import { AI_CHAT_PROGRAMMATIC_SCROLL_EVENT } from '@affine/core/blocksuite/ai/components/ai-chat-messages/auto-scroll';
import { type RefObject, useEffect, useState } from 'react';

const HIDE_DISTANCE = 40;
const REVEAL_DISTANCE = 16;
const TOP_THRESHOLD = 8;
const INPUT_TIMEOUT = 800;
const OPEN_MENU =
  '[aria-haspopup][aria-expanded="true"], [data-testid="ai-panel-chat-history"][aria-expanded="true"]';

/** Only the message stream's user-driven scrolling controls the title card. */
export function useConversationHeaderVisibility({
  contentRef,
  headerRef,
  enabled,
  sessionKey,
}: {
  contentRef: RefObject<HTMLElement | null>;
  headerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  sessionKey: string;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(false);
    const content = contentRef.current;
    const header = headerRef.current;
    if (!enabled || !content || !header) return;

    let scroller: HTMLElement | null = null;
    let lastTop = 0;
    let direction = 0;
    let distance = 0;
    let inputUntil = 0;
    let touchY: number | null = null;
    let draggingScrollbar = false;
    let hovered = header.matches(':hover');

    const resetIntent = () => {
      direction = 0;
      distance = 0;
      inputUntil = 0;
    };
    const reveal = () => {
      resetIntent();
      setHidden(false);
    };
    const protectedHeader = () =>
      hovered ||
      header.contains(document.activeElement) ||
      !!header.querySelector(OPEN_MENU);
    const messageTarget = (event: Event) =>
      event
        .composedPath()
        .find(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node.matches('ai-chat-messages')
        );
    const track = (target: HTMLElement) => {
      if (scroller !== target) {
        resetIntent();
        scroller = target;
        lastTop = target.scrollTop;
      }
    };
    const arm = (event: Event, nextDirection: number) => {
      const target = messageTarget(event);
      if (!target || !nextDirection) return;
      track(target);
      if (direction !== nextDirection) distance = 0;
      direction = nextDirection;
      inputUntil = performance.now() + INPUT_TIMEOUT;
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        arm(event, Math.sign(event.deltaY));
      } else {
        resetIntent();
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      resetIntent();
      touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchY === null || event.touches.length !== 1) {
        resetIntent();
        return;
      }
      const y = event.touches[0].clientY;
      arm(event, Math.sign(touchY - y));
      touchY = y;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event
          .composedPath()
          .some(
            node =>
              node instanceof HTMLElement &&
              node.matches(
                'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"]'
              )
          )
      ) {
        resetIntent();
        return;
      }
      if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) arm(event, 1);
      else if (['ArrowUp', 'PageUp', 'Home'].includes(event.key))
        arm(event, -1);
      else if (event.key === ' ') arm(event, event.shiftKey ? -1 : 1);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = messageTarget(event);
      if (!target || event.target !== target || event.button !== 0) return;
      const rect = target.getBoundingClientRect();
      // Native scrollbar interaction has no wheel/touch event.
      if (
        event.clientX >= rect.left + target.clientLeft + target.clientWidth ||
        event.clientX < rect.left + target.clientLeft
      ) {
        track(target);
        draggingScrollbar = true;
      }
    };
    const onPointerUp = () => {
      draggingScrollbar = false;
      resetIntent();
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !target.matches('ai-chat-messages')
      )
        return;
      track(target);
      const top = Math.max(0, target.scrollTop);
      const delta = top - lastTop;
      lastTop = top;
      if (top <= TOP_THRESHOLD) {
        distance = 0;
        setHidden(false);
        return;
      }
      if (protectedHeader()) {
        reveal();
        return;
      }
      if (!delta) return;
      if (draggingScrollbar) {
        const nextDirection = Math.sign(delta);
        if (direction !== nextDirection) distance = 0;
        direction = nextDirection;
      } else if (
        performance.now() > inputUntil ||
        Math.sign(delta) !== direction
      ) {
        distance = 0;
        return;
      }
      inputUntil = performance.now() + INPUT_TIMEOUT;
      distance += Math.abs(delta);
      if (distance >= (direction > 0 ? HIDE_DISTANCE : REVEAL_DISTANCE)) {
        setHidden(direction > 0);
        distance = 0;
      }
    };
    const onProgrammaticScroll = () => {
      draggingScrollbar = false;
      resetIntent();
    };
    const onScrollEnd = (event: Event) => {
      if (event.target === scroller && !draggingScrollbar) resetIntent();
    };
    const onPointerEnter = () => {
      hovered = true;
      reveal();
    };
    const onPointerLeave = () => {
      hovered = false;
      resetIntent();
    };
    const menuObserver = new MutationObserver(() => {
      if (header.querySelector(OPEN_MENU)) reveal();
    });
    menuObserver.observe(header, {
      attributes: true,
      attributeFilter: ['aria-expanded'],
      childList: true,
      subtree: true,
    });
    const events = new AbortController();
    const options = { capture: true, passive: true, signal: events.signal };
    content.addEventListener('wheel', onWheel, options);
    content.addEventListener('touchstart', onTouchStart, options);
    content.addEventListener('touchmove', onTouchMove, options);
    content.addEventListener('keydown', onKeyDown, options);
    content.addEventListener('pointerdown', onPointerDown, options);
    content.addEventListener('scroll', onScroll, options);
    content.addEventListener('scrollend', onScrollEnd, options);
    content.addEventListener(
      AI_CHAT_PROGRAMMATIC_SCROLL_EVENT,
      onProgrammaticScroll,
      options
    );
    header.addEventListener('pointerenter', onPointerEnter, options);
    header.addEventListener('pointerleave', onPointerLeave, options);
    header.addEventListener('focusin', reveal, options);
    document.addEventListener('pointerup', onPointerUp, options);
    document.addEventListener('pointercancel', onPointerUp, options);
    return () => {
      events.abort();
      menuObserver.disconnect();
    };
  }, [contentRef, enabled, headerRef, sessionKey]);

  return hidden;
}
