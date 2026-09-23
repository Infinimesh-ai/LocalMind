import { DisposableGroup } from '@blocksuite/global/disposable';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { UIEventHandler, UIEventStateContext } from '../event/base.js';
import { KeyboardControl } from '../event/control/keyboard.js';
import type { EventName, UIEventDispatcher } from '../event/dispatcher.js';

describe('KeyboardControl IME confirmation', () => {
  let disposables: DisposableGroup;
  let enter: ReturnType<typeof vi.fn<UIEventHandler>>;
  let run: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    disposables = new DisposableGroup();
    enter = vi.fn((ctx: UIEventStateContext) => {
      ctx.get('keyboardState').raw.preventDefault();
      return true;
    });
    const handlers = new Map<EventName, UIEventHandler>();
    run = vi.fn((name: EventName, ctx: UIEventStateContext) => {
      handlers.get(name)?.(ctx);
    });
    const dispatcher = {
      disposables,
      run,
      add: (name: EventName, handler: UIEventHandler) => {
        handlers.set(name, handler);
        return () => handlers.delete(name);
      },
    } as unknown as UIEventDispatcher;
    const keyboard = new KeyboardControl(dispatcher);
    keyboard.listen();
    disposables.add(keyboard.bindHotkey({ Enter: enter }));
  });

  afterEach(() => disposables.dispose());

  function pressEnter(isComposing = false, keyCode = 13) {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      isComposing,
      cancelable: true,
    });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    document.dispatchEvent(event);
    return event;
  }

  test('leaves an active IME confirmation to the input method', () => {
    expect(pressEnter(true, 229).defaultPrevented).toBe(false);
    expect(enter).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  test('uses tracked composition state when the key flag is missing', () => {
    document.dispatchEvent(new CompositionEvent('compositionstart'));
    expect(pressEnter().defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    document.dispatchEvent(new CompositionEvent('compositionend'));
    expect(pressEnter().defaultPrevented).toBe(true);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  test('ignores IME Enter after compositionend, then accepts normal Enter', () => {
    document.dispatchEvent(new CompositionEvent('compositionstart'));
    document.dispatchEvent(new CompositionEvent('compositionend'));
    expect(pressEnter(false, 229).defaultPrevented).toBe(false);
    expect(enter).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(pressEnter().defaultPrevented).toBe(true);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  test.each(['keyup', 'keypress'])('ignores IME %s events', type => {
    const event = new KeyboardEvent(type, { key: 'Enter' });
    Object.defineProperty(event, 'keyCode', { value: 229 });
    document.dispatchEvent(event);
    expect(run).not.toHaveBeenCalled();
  });
});
