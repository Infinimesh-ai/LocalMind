/** @vitest-environment happy-dom */
import { afterEach, expect, test, vi } from 'vitest';

import { officeAssetUrl } from './client';

const originalUrl = window.location.href;

afterEach(() => {
  window.location.href = originalUrl;
  vi.unstubAllGlobals();
});

test('rewrites authenticated Office assets across local loopback aliases', () => {
  vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, debug: true, isWeb: true });
  window.location.href = 'http://localhost:8080/project/p';

  expect(
    officeAssetUrl(
      'http://0.0.0.0:3025/api/projects/p/office/artifacts/a/revisions/r/state'
    )
  ).toBe(
    'http://localhost:8080/api/projects/p/office/artifacts/a/revisions/r/state'
  );
});

test('does not rewrite non-local or unrecognized asset routes', () => {
  vi.stubGlobal('BUILD_CONFIG', { ...BUILD_CONFIG, debug: true, isWeb: true });
  window.location.href = 'http://localhost:8080/project/p';

  expect(
    officeAssetUrl(
      'https://assets.example.test/api/projects/p/office/artifacts/a/revisions/r/state'
    )
  ).toBe(
    'https://assets.example.test/api/projects/p/office/artifacts/a/revisions/r/state'
  );
  expect(officeAssetUrl('http://0.0.0.0:3025/api/other/state')).toBe(
    'http://0.0.0.0:3025/api/other/state'
  );
});
