import { ColorScheme } from '@blocksuite/affine-model';
import { ThemeProvider } from '@blocksuite/affine-shared/services';
import { LifeCycleWatcher } from '@blocksuite/std';
import { type Signal, signal } from '@preact/signals-core';
import type { BundledLanguageInfo, HighlighterCore, MaybeGetter } from 'shiki';

import { CodeBlockConfigExtension } from './code-block-config.js';
import {
  CODE_BLOCK_DEFAULT_DARK_THEME,
  CODE_BLOCK_DEFAULT_LIGHT_THEME,
} from './highlight/const.js';

export class CodeBlockHighlighter extends LifeCycleWatcher {
  static override key = 'code-block-highlighter';

  // Singleton highlighter instance
  private static _sharedHighlighter: HighlighterCore | null = null;
  private static _highlighterPromise: Promise<HighlighterCore> | null = null;
  private static _bundledLanguagesInfo: BundledLanguageInfo[] = [];
  private static _refCount = 0;

  private _darkThemeKey: string | undefined;
  private _lightThemeKey: string | undefined;
  private _loadPromise: Promise<void> | null = null;

  highlighter$: Signal<HighlighterCore | null> = signal(null);
  langs$: Signal<BundledLanguageInfo[]> = signal([]);

  get themeKey() {
    const theme = this.std.get(ThemeProvider).theme$.value;
    return theme === ColorScheme.Dark
      ? this._darkThemeKey
      : this._lightThemeKey;
  }

  private readonly _loadTheme = async (
    highlighter: HighlighterCore
  ): Promise<void> => {
    if (!CodeBlockHighlighter._isHighlighterInUse(highlighter)) {
      return;
    }

    const config = this.std.getOptional(CodeBlockConfigExtension.identifier);
    const darkTheme = config?.theme?.dark ?? CODE_BLOCK_DEFAULT_DARK_THEME;
    const lightTheme = config?.theme?.light ?? CODE_BLOCK_DEFAULT_LIGHT_THEME;
    this._darkThemeKey = (await normalizeGetter(darkTheme)).name;
    this._lightThemeKey = (await normalizeGetter(lightTheme)).name;

    if (!CodeBlockHighlighter._isHighlighterInUse(highlighter)) {
      return;
    }

    await highlighter.loadTheme(darkTheme, lightTheme);

    if (!CodeBlockHighlighter._isHighlighterInUse(highlighter)) {
      return;
    }

    this.highlighter$.value = highlighter;
  };

  private static async _getOrCreateHighlighter(): Promise<HighlighterCore> {
    if (CodeBlockHighlighter._sharedHighlighter) {
      return CodeBlockHighlighter._sharedHighlighter;
    }

    if (!CodeBlockHighlighter._highlighterPromise) {
      CodeBlockHighlighter._highlighterPromise = Promise.all([
        import('shiki'),
        import('shiki/wasm'),
      ]).then(([shiki, wasm]) => {
        CodeBlockHighlighter._bundledLanguagesInfo = shiki.bundledLanguagesInfo;
        return shiki
          .createHighlighterCore({
            engine: shiki.createOnigurumaEngine(() => wasm.default),
          })
          .then(highlighter => {
            CodeBlockHighlighter._sharedHighlighter = highlighter;
            return highlighter;
          });
      });
    }

    return CodeBlockHighlighter._highlighterPromise;
  }

  load(): Promise<void> {
    if (!this._loadPromise) {
      const loadPromise = CodeBlockHighlighter._getOrCreateHighlighter().then(
        highlighter => {
          this.langs$.value = CodeBlockHighlighter._bundledLanguagesInfo;
          return this._loadTheme(highlighter);
        }
      );
      this._loadPromise = loadPromise;
      loadPromise.catch(() => {
        if (this._loadPromise === loadPromise) {
          this._loadPromise = null;
        }
      });
    }
    return this._loadPromise;
  }

  override mounted(): void {
    super.mounted();

    CodeBlockHighlighter._refCount++;
  }

  override unmounted(): void {
    CodeBlockHighlighter._refCount = Math.max(
      0,
      CodeBlockHighlighter._refCount - 1
    );
    this._loadPromise = null;
    this.highlighter$.value = null;
    this.langs$.value = [];
  }

  private static _isHighlighterInUse(highlighter: HighlighterCore) {
    return (
      CodeBlockHighlighter._refCount > 0 &&
      CodeBlockHighlighter._sharedHighlighter === highlighter
    );
  }
}

/**
 * https://github.com/shikijs/shiki/blob/933415cdc154fe74ccfb6bbb3eb6a7b7bf183e60/packages/core/src/internal.ts#L31
 */
export async function normalizeGetter<T>(p: MaybeGetter<T>): Promise<T> {
  return Promise.resolve(typeof p === 'function' ? (p as any)() : p).then(
    r => r.default || r
  );
}
