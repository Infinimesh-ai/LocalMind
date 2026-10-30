/** @vitest-environment happy-dom */
import { AI_CHAT_PROGRAMMATIC_SCROLL_EVENT } from '@affine/core/blocksuite/ai/components/ai-chat-messages/auto-scroll';
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { useConversationHeaderVisibility } from './use-conversation-header-visibility';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup() {
  const content = document.createElement('div');
  const messages = document.createElement('ai-chat-messages');
  const header = document.createElement('header');
  const button = document.createElement('button');
  const outside = document.createElement('div');
  header.append(button);
  content.append(messages);
  document.body.append(header, content, outside);
  messages.scrollTop = 100;
  const contentRef = { current: content };
  const headerRef = { current: header };
  const hook = renderHook(
    ({ sessionKey }) =>
      useConversationHeaderVisibility({
        contentRef,
        headerRef,
        enabled: true,
        sessionKey,
      }),
    { initialProps: { sessionKey: 'session-1' } }
  );
  const scroll = (top: number, target = messages) => {
    act(() => {
      target.scrollTop = top;
      fireEvent.scroll(target);
    });
  };
  const wheel = (deltaY: number, target: HTMLElement = messages) => {
    fireEvent.wheel(target, { deltaY });
  };
  return { ...hook, content, messages, header, button, outside, scroll, wheel };
}

test('uses actual message scroll distance with separate hide and reveal thresholds', () => {
  const { result, wheel, scroll } = setup();
  expect(result.current).toBe(false);
  wheel(100);
  expect(result.current).toBe(false);
  scroll(120);
  expect(result.current).toBe(false);
  scroll(140);
  expect(result.current).toBe(true);
  wheel(-100);
  scroll(130);
  expect(result.current).toBe(true);
  scroll(124);
  expect(result.current).toBe(false);
});

test('direction reversal discards earlier travel and stopping does not reveal the header', () => {
  const { result, wheel, scroll, messages } = setup();
  wheel(30);
  scroll(130);
  wheel(-5);
  scroll(125);
  wheel(20);
  scroll(145);
  expect(result.current).toBe(false);
  scroll(165);
  expect(result.current).toBe(true);
  fireEvent(messages, new Event('scrollend'));
  expect(result.current).toBe(true);
});

test('ignores automatic scrolling, including a smooth scroll started immediately after wheel input', () => {
  const { result, wheel, scroll, messages } = setup();
  scroll(300);
  expect(result.current).toBe(false);
  wheel(80);
  fireEvent(
    messages,
    new Event(AI_CHAT_PROGRAMMATIC_SCROLL_EVENT, { bubbles: true })
  );
  scroll(380);
  expect(result.current).toBe(false);
  wheel(40);
  scroll(420);
  expect(result.current).toBe(true);
  scroll(360);
  expect(result.current).toBe(true);
});

test('scrolls in the sidebar or nested message content do not drive the title card', () => {
  const { result, messages, outside, wheel, scroll } = setup();
  const nested = document.createElement('div');
  messages.append(nested);
  wheel(100, outside);
  scroll(200, outside);
  wheel(100, nested);
  scroll(200, nested);
  expect(result.current).toBe(false);
});

test('hover, focus and an open portalled history menu keep the title visible', async () => {
  const { result, header, button, wheel, scroll } = setup();
  fireEvent.pointerEnter(header);
  wheel(50);
  scroll(150);
  expect(result.current).toBe(false);
  fireEvent.pointerLeave(header);
  wheel(40);
  scroll(190);
  expect(result.current).toBe(true);
  act(() => button.focus());
  expect(result.current).toBe(false);
  wheel(50);
  scroll(240);
  expect(result.current).toBe(false);
  act(() => button.blur());
  button.dataset.testid = 'ai-panel-chat-history';
  await act(async () => button.setAttribute('aria-expanded', 'true'));
  wheel(100);
  scroll(340);
  expect(result.current).toBe(false);
  await act(async () => button.setAttribute('aria-expanded', 'false'));
  wheel(40);
  scroll(380);
  expect(result.current).toBe(true);
});

test('top-of-stream and session changes reveal the title without changing scroll position', () => {
  const { result, wheel, scroll, messages, rerender } = setup();
  wheel(40);
  scroll(140);
  expect(result.current).toBe(true);
  scroll(0);
  expect(result.current).toBe(false);
  wheel(100);
  scroll(5);
  scroll(45);
  expect(result.current).toBe(true);
  rerender({ sessionKey: 'session-2' });
  expect(result.current).toBe(false);
  expect(messages.scrollTop).toBe(45);
});

test('keyboard and touch scrolling work, but typing and zoom gestures do not count', () => {
  const { result, messages, wheel, scroll } = setup();
  const input = document.createElement('textarea');
  messages.append(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  scroll(150);
  expect(result.current).toBe(false);
  wheel(20);
  scroll(170);
  const zoom = new WheelEvent('wheel', { deltaY: 100, bubbles: true });
  // This happy-dom version does not initialize WheelEvent modifier keys.
  Object.defineProperty(zoom, 'ctrlKey', { value: true });
  fireEvent(messages, zoom);
  scroll(250);
  expect(result.current).toBe(false);
  fireEvent.keyDown(messages, { key: 'PageDown' });
  scroll(290);
  expect(result.current).toBe(true);
  fireEvent.touchStart(messages, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(messages, { touches: [{ clientY: 120 }] });
  scroll(270);
  expect(result.current).toBe(false);
  wheel(40);
  scroll(310);
  expect(result.current).toBe(true);
});

test('native scrollbar dragging controls visibility and cleanup detaches listeners', () => {
  const { result, messages, scroll, unmount } = setup();
  Object.defineProperty(messages, 'clientWidth', { value: 100 });
  fireEvent.pointerDown(messages, { button: 0, clientX: 101 });
  scroll(150);
  expect(result.current).toBe(true);
  scroll(130);
  expect(result.current).toBe(false);
  fireEvent.pointerUp(document);
  scroll(230);
  expect(result.current).toBe(false);
  unmount();
  fireEvent.pointerDown(messages, { button: 0, clientX: 101 });
  scroll(330);
  expect(result.current).toBe(false);
});
