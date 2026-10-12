import { DebugLogger } from '@affine/debug';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  type ClientLogEvent,
  installLocalMindConsoleBridge,
  LocalMindClientLogTransport,
} from './client-transport';

const transports: LocalMindClientLogTransport[] = [];
function transport(maxQueue = 200) {
  const instance = new LocalMindClientLogTransport(
    'http://instance.test',
    maxQueue
  );
  transports.push(instance);
  return instance;
}
function events(init?: RequestInit): ClientLogEvent[] {
  return (JSON.parse(String(init?.body)) as { events: ClientLogEvent[] })
    .events;
}
const accept = async (_url: RequestInfo | URL, init?: RequestInit) =>
  Response.json({ eventIds: events(init).map(event => event.eventId) });

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.localStorage?.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
  );
});
afterEach(() => {
  transports.splice(0).forEach(instance => instance.dispose());
  installLocalMindConsoleBridge(null);
  DebugLogger.setSink(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('keeps a bounded sanitized queue during an outage and retries without a new event', async () => {
  const instance = transport(1);
  await instance.write({
    eventName: 'client.error',
    metadata: { apiKey: 'secret', ok: true },
  });
  await instance.write({ eventName: 'client.warn', metadata: { ok: true } });
  expect(instance.pending).toBe(1);
  const fetchMock = vi.mocked(fetch);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]?.body).not.toContain('secret');
  fetchMock.mockImplementation(accept);
  await vi.advanceTimersByTimeAsync(1000);
  expect(instance.pending).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('200 concurrent writes produce two bounded batches with one request in flight', async () => {
  let active = 0;
  let peak = 0;
  const sent: string[] = [];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    peak = Math.max(peak, ++active);
    const batch = events(init);
    expect(batch.length).toBeLessThanOrEqual(100);
    sent.push(...batch.map(event => event.eventId!));
    await Promise.resolve();
    active--;
    return accept(url, init);
  });
  const instance = transport();
  await Promise.all(
    Array.from({ length: 200 }, (_, index) =>
      instance.write({ eventId: `event-${index}`, eventName: 'client.info' })
    )
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(peak).toBe(1);
  expect(sent).toHaveLength(200);
  expect(new Set(sent).size).toBe(200);
  expect(instance.pending).toBe(0);
});

test('a receipt cannot remove an event added while the request was in flight', async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch)
    .mockImplementationOnce(
      () =>
        new Promise<Response>(done => {
          resolve = done;
        })
    )
    .mockImplementation(accept);
  const instance = transport();
  const first = instance.write({ eventId: 'first', eventName: 'client.info' });
  await Promise.resolve();
  const second = instance.write({
    eventId: 'second',
    eventName: 'client.info',
  });
  resolve(Response.json({ eventIds: ['first', 'second', 'unknown'] }));
  await Promise.all([first, second]);
  expect(
    events(vi.mocked(fetch).mock.calls[1][1]).map(event => event.eventId)
  ).toEqual(['second']);
  expect(instance.pending).toBe(0);
});

test('partial receipts retain the unaccepted events for a delayed retry', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json({ eventIds: ['first'] }))
    .mockImplementation(accept);
  const instance = transport();
  await Promise.all([
    instance.write({ eventId: 'first', eventName: 'client.info' }),
    instance.write({ eventId: 'second', eventName: 'client.info' }),
  ]);
  expect(instance.pending).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(
    events(vi.mocked(fetch).mock.calls[1][1]).map(event => event.eventId)
  ).toEqual(['second']);
  expect(instance.pending).toBe(0);
});

test('an HTTP success without event receipts keeps the queue', async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ accepted: 1 }));
  const instance = transport();
  await instance.write({ eventName: 'client.info' });
  expect(instance.pending).toBe(1);
});

test('a stuck upload is aborted and disposal cancels retries', async () => {
  vi.mocked(fetch).mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted'))
        );
      })
  );
  const instance = transport();
  const write = instance.write({ eventName: 'client.info' });
  await vi.advanceTimersByTimeAsync(10000);
  await write;
  expect(instance.pending).toBe(1);
  instance.dispose();
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('debug sink and console bridge capture enabled debug output once', async () => {
  vi.mocked(fetch).mockImplementation(accept);
  const instance = transport();
  installLocalMindConsoleBridge(instance);
  DebugLogger.setSink(event => {
    void instance.write({
      eventName: `client.debug.${event.namespace}`,
      severity: event.level,
    });
  });
  const logger = new DebugLogger('transport-regression');
  logger.enabled = true;
  logger.info('one event');
  await instance.flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(events(vi.mocked(fetch).mock.calls[0][1])).toHaveLength(1);
  logger.enabled = false;
  logger.debug('disabled event');
  await instance.flush();
  expect(fetch).toHaveBeenCalledTimes(1);
});
