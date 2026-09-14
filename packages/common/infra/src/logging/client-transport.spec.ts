import { beforeEach, expect, test, vi } from 'vitest';

import { LocalMindClientLogTransport } from './client-transport';

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;
});

test('client transport keeps bounded sanitized queue during outage', async () => {
  const transport = new LocalMindClientLogTransport('http://instance.test', 1);
  await transport.write({
    eventName: 'client.error',
    metadata: { apiKey: 'secret', ok: true },
  });
  await transport.write({ eventName: 'client.warn', metadata: { ok: true } });
  expect(transport.pending).toBe(1);
  const request = (globalThis.fetch as any).mock.calls.at(-1)[1];
  expect(request.body).not.toContain('secret');
});

test('client transport retries and clears after instance accepts batch', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  globalThis.fetch = fetchMock as any;
  const transport = new LocalMindClientLogTransport('http://instance.test');
  await transport.write({ eventName: 'client.info' });
  expect(transport.pending).toBe(0);
});
