import { afterEach, describe, expect, test } from 'vitest';

import { getBuildConfig } from './build-config';
import { Package } from './workspace';

const originalCloudUrl = process.env.LOCALMIND_CLOUD_URL;
const originalDevServerUrl = process.env.DEV_SERVER_URL;

afterEach(() => {
  if (originalCloudUrl === undefined) {
    delete process.env.LOCALMIND_CLOUD_URL;
  } else {
    process.env.LOCALMIND_CLOUD_URL = originalCloudUrl;
  }

  if (originalDevServerUrl === undefined) {
    delete process.env.DEV_SERVER_URL;
  } else {
    process.env.DEV_SERVER_URL = originalDevServerUrl;
  }
});

describe('LocalMind cloud build config', () => {
  test('uses the LocalMind cloud by default', () => {
    delete process.env.LOCALMIND_CLOUD_URL;
    delete process.env.DEV_SERVER_URL;

    const config = getBuildConfig(new Package('@affine/electron'), {
      channel: 'stable',
      mode: 'production',
    });

    expect(config.cloudUrl).toBe('https://localmind.infinimesh.cloud');
  });

  test('normalizes an explicit private deployment URL', () => {
    process.env.LOCALMIND_CLOUD_URL = 'https://localmind.example.com/';

    const config = getBuildConfig(new Package('@affine/electron'), {
      channel: 'stable',
      mode: 'production',
    });

    expect(config.cloudUrl).toBe('https://localmind.example.com');
  });

  test.each([
    'file:///tmp/localmind',
    'https://user:password@localmind.example.com',
    'https://localmind.example.com?target=affine',
    'https://localmind.example.com#affine',
  ])('rejects an unsafe cloud URL: %s', cloudUrl => {
    process.env.LOCALMIND_CLOUD_URL = cloudUrl;

    expect(() =>
      getBuildConfig(new Package('@affine/electron'), {
        channel: 'stable',
        mode: 'production',
      })
    ).toThrow('LOCALMIND_CLOUD_URL');
  });
});
