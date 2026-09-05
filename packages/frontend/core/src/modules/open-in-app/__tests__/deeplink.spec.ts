import { appSchemaUrl, channelToScheme } from '@affine/core/utils/channel';
import { expect, test } from 'vitest';

import {
  buildAuthenticationDeepLink,
  buildOpenAppUrlRoute,
  normalizeOpenAppSignInNextParam,
} from '../utils';

test('buildAuthenticationDeepLink', () => {
  const payload = { code: '1', next: '/workspace/123' };
  const url = buildAuthenticationDeepLink({
    scheme: 'localmind',
    method: 'open-app-signin',
    payload,
    server: 'https://app.affine.local',
  });

  const parsed = new URL(url);

  expect(parsed.protocol).toBe('localmind:');
  expect(parsed.hostname).toBe('authentication');
  expect(parsed.searchParams.get('method')).toBe('open-app-signin');
  expect(parsed.searchParams.get('payload')).toBe(JSON.stringify(payload));
  expect(parsed.searchParams.get('server')).toBe('https://app.affine.local');
});

test('buildOpenAppUrlRoute', () => {
  const urlToOpen = 'localmind://authentication?method=oauth&payload=%7B%7D';
  const route = buildOpenAppUrlRoute(urlToOpen);

  const parsed = new URL(route, 'https://app.affine.local');
  expect(parsed.pathname).toBe('/open-app/url');
  expect(parsed.searchParams.get('url')).toBe(urlToOpen);
});

test('uses LocalMind schemes and accepts legacy app links', () => {
  expect(channelToScheme.stable).toBe('localmind');
  expect(channelToScheme.beta).toBe('localmind-beta');
  expect(appSchemaUrl.safeParse('localmind://authentication').success).toBe(
    true
  );
  expect(appSchemaUrl.safeParse('affine://authentication').success).toBe(true);
});

test('normalizeOpenAppSignInNextParam', () => {
  expect(
    normalizeOpenAppSignInNextParam(
      '/workspace/123',
      'https://app.affine.local'
    )
  ).toBe('/workspace/123');

  expect(
    normalizeOpenAppSignInNextParam(
      'https://app.affine.local/workspace/123?foo=1#bar',
      'https://app.affine.local'
    )
  ).toBe('/workspace/123?foo=1#bar');

  expect(
    normalizeOpenAppSignInNextParam(
      '/intelligence?project=project-1#in-progress',
      'https://app.affine.local'
    )
  ).toBe('/intelligence?project=project-1#in-progress');

  expect(
    normalizeOpenAppSignInNextParam(
      'https://app.affine.local/intelligence',
      'https://app.affine.local'
    )
  ).toBe('/intelligence');

  expect(
    normalizeOpenAppSignInNextParam(
      '/tasks?filter=all&taskId=workspace-b-task',
      'https://app.affine.local'
    )
  ).toBe('/tasks?filter=all&taskId=workspace-b-task');

  expect(
    normalizeOpenAppSignInNextParam(
      '/tasks-redirect?next=https://evil.example',
      'https://app.affine.local'
    )
  ).toBeUndefined();

  expect(
    normalizeOpenAppSignInNextParam(
      '/intelligence-redirect?next=https://evil.example',
      'https://app.affine.local'
    )
  ).toBeUndefined();

  expect(
    normalizeOpenAppSignInNextParam(
      'https://evil.example/workspace/123',
      'https://app.affine.local'
    )
  ).toBeUndefined();

  expect(
    normalizeOpenAppSignInNextParam(
      '//evil.example/workspace/123',
      'https://app.affine.local'
    )
  ).toBeUndefined();

  expect(
    normalizeOpenAppSignInNextParam(
      '/redirect-proxy?redirect_uri=https://evil.example',
      'https://app.affine.local'
    )
  ).toBeUndefined();
});
