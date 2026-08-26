import { createIdentifier } from '@blocksuite/global/di';
import { IS_FIREFOX } from '@blocksuite/global/env';
import { LifeCycleWatcher } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';

import type { FontConfig } from './config.js';

const initFontFace = IS_FIREFOX
  ? ({ font, weight, url, style }: FontConfig) =>
      new FontFace(`"${font}"`, `url(${url})`, {
        weight,
        style,
      })
  : ({ font, weight, url, style }: FontConfig) =>
      new FontFace(font, `url(${url})`, {
        weight,
        style,
      });

export class FontLoaderService extends LifeCycleWatcher {
  static override readonly key = 'font-loader';

  private readonly _loadedFontKeys = new Set<string>();

  private _readyPromise: Promise<FontFace[]> | null = null;

  readonly fontFaces: FontFace[] = [];

  get ready() {
    return (this._readyPromise ??= Promise.all(
      this.fontFaces.map(fontFace => fontFace.load())
    ));
  }

  private readonly _fontKey = ({ font, weight, style, url }: FontConfig) => {
    return `${font}:${weight}:${style}:${url}`;
  };

  private readonly _register = (fonts: FontConfig[]) => {
    const registered: FontFace[] = [];
    for (const font of fonts) {
      const key = this._fontKey(font);
      if (this._loadedFontKeys.has(key)) {
        continue;
      }
      this._loadedFontKeys.add(key);
      const fontFace = initFontFace(font);
      document.fonts.add(fontFace);
      this.fontFaces.push(fontFace);
      registered.push(fontFace);
    }
    if (registered.length > 0) {
      this._readyPromise = null;
    }
    return registered;
  };

  load(fonts: FontConfig[]) {
    return Promise.all(this._register(fonts).map(fontFace => fontFace.load()));
  }

  override mounted() {
    const config = this.std.getOptional(FontConfigIdentifier);
    if (!config || config.length === 0) {
      return;
    }

    // Register canvas fonts without downloading them on ordinary document pages.
    // Edgeless roots request `ready`, which starts the actual font loads.
    this._register(config);
  }

  override unmounted() {
    for (const fontFace of this.fontFaces) {
      document.fonts.delete(fontFace);
    }
    this.fontFaces.splice(0, this.fontFaces.length);
    this._loadedFontKeys.clear();
    this._readyPromise = null;
  }
}

export const FontConfigIdentifier =
  createIdentifier<FontConfig[]>('AffineFontConfig');

export const FontConfigExtension = (
  fontConfig: FontConfig[]
): ExtensionType => ({
  setup: di => {
    di.addImpl(FontConfigIdentifier, () => fontConfig);
  },
});
