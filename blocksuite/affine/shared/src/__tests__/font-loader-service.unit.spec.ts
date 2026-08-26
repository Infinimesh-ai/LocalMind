import { afterEach, describe, expect, test, vi } from 'vitest';

import { FontLoaderService } from '../services/font-loader/font-loader-service.js';

const fontConfig = [
  {
    font: 'Inter',
    weight: '400',
    style: 'normal',
    url: '/inter.woff2',
  },
  {
    font: 'Kalam',
    weight: '700',
    style: 'normal',
    url: '/kalam.woff2',
  },
];

describe('FontLoaderService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('registers canvas fonts without loading them until ready is requested', async () => {
    const add = vi.fn();
    const remove = vi.fn();
    const load = vi.fn(function (this: FontFace) {
      return Promise.resolve(this);
    });

    class FontFaceMock {
      load = load;

      constructor(
        readonly family: string,
        readonly source: string,
        readonly descriptors?: FontFaceDescriptors
      ) {}
    }

    vi.stubGlobal('FontFace', FontFaceMock);
    vi.stubGlobal('document', { fonts: { add, delete: remove } });

    const service = new FontLoaderService({
      getOptional: () => fontConfig,
    } as never);

    service.mounted();

    expect(add).toHaveBeenCalledTimes(2);
    expect(load).not.toHaveBeenCalled();

    await service.ready;
    await service.ready;

    expect(load).toHaveBeenCalledTimes(2);

    service.unmounted();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
