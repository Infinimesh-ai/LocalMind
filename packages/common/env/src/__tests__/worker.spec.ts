import { afterEach, expect, test, vi } from 'vitest';

import { getWorkerUrl } from '../worker';

afterEach(() => vi.unstubAllGlobals());

test('web workers use a new URL for each build within the same app version', () => {
  vi.stubGlobal('environment', { subPath: '/localmind/' });
  const config = {
    appVersion: '0.27.0',
    workerBuildId: 'first',
    isWeb: true,
    isMobileWeb: false,
  };
  vi.stubGlobal('BUILD_CONFIG', config);
  expect(getWorkerUrl('nbstore')).toBe(
    '/localmind/js/nbstore-0.27.0.worker.js?build=first'
  );
  config.workerBuildId = 'second';
  expect(getWorkerUrl('nbstore')).toBe(
    '/localmind/js/nbstore-0.27.0.worker.js?build=second'
  );
});

test('native worker paths keep their file URL contract', () => {
  vi.stubGlobal('environment', { subPath: '/' });
  vi.stubGlobal('BUILD_CONFIG', {
    appVersion: '0.27.0',
    workerBuildId: 'first',
    isWeb: false,
    isMobileWeb: false,
  });
  expect(getWorkerUrl('nbstore')).toBe('/js/nbstore-0.27.0.worker.js');
});
