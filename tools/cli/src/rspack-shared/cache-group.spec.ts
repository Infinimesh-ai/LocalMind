import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getAsyncVendorChunkName } from './cache-group';

void describe('getAsyncVendorChunkName', () => {
  const shikiAssets = [
    [
      '/repo/node_modules/@shikijs/langs/dist/typescript.mjs',
      'npm-async-shiki-langs-typescript',
    ],
    [
      'C:\\repo\\node_modules\\@shikijs\\themes\\dist\\dark-plus.mjs',
      'npm-async-shiki-themes-dark-plus',
    ],
  ] as const;

  for (const [modulePath, expected] of shikiAssets) {
    void test(`splits ${expected} by module`, () => {
      assert.equal(getAsyncVendorChunkName(modulePath), expected);
    });
  }

  void test('keeps package-level grouping for other async dependencies', () => {
    assert.equal(
      getAsyncVendorChunkName('/repo/node_modules/pdfmake/build/pdfmake.js'),
      'npm-async-pdfmake'
    );
  });
});
