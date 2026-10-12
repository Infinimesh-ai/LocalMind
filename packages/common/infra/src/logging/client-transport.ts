import { DebugLogger } from '@affine/debug';
import { nanoid } from 'nanoid';

export type ClientLogEvent = {
  eventId?: string;
  eventName: string;
  severity?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message?: string;
  metadata?: Record<string, unknown>;
};

let consoleBridgeInstalled = false;
let activeConsoleTransport: LocalMindClientLogTransport | null = null;

/** Capture legacy browser console calls into the instance log transport. */
export function installLocalMindConsoleBridge(
  transport: LocalMindClientLogTransport | null
) {
  activeConsoleTransport = transport;
  if (consoleBridgeInstalled || typeof console === 'undefined') return;
  consoleBridgeInstalled = true;
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level].bind(console);
    console[level] = ((...args: unknown[]) => {
      original(...args);
      const target = activeConsoleTransport;
      if (!target || DebugLogger.isMirroringToConsole) return;
      const [message, ...metadata] = args;
      void target
        .write({
          eventName: `client.console.${level}`,
          severity:
            level === 'error'
              ? 'error'
              : level === 'warn'
                ? 'warn'
                : level === 'debug'
                  ? 'debug'
                  : 'info',
          message: typeof message === 'string' ? message : undefined,
          metadata: metadata.length ? { args: metadata } : undefined,
        })
        .catch(() => undefined);
    }) as (typeof console)[typeof level];
  }
}

const SENSITIVE_KEY =
  /api[_-]?key|token|secret|password|cookie|authorization|credential|prompt|content|body|attachment|request|response/i;
const SENSITIVE_VALUE =
  /sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i;

function sanitize(value: unknown): unknown {
  if (typeof value === 'string')
    return SENSITIVE_VALUE.test(value)
      ? '[redacted]'
      : value.length > 2048
        ? `${value.slice(0, 2048)}…`
        : value;
  if (Array.isArray(value)) return value.slice(0, 32).map(sanitize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 64)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(item),
        ])
    );
  return value;
}

export class LocalMindClientLogTransport {
  private readonly queue: ClientLogEvent[];
  private readonly storageKey: string;
  private flushing?: Promise<void>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 1000;
  private request?: AbortController;
  private disposed = false;
  constructor(
    private readonly endpoint: string,
    private readonly maxQueue = 200
  ) {
    this.storageKey = `localmind-log-queue:${endpoint}`;
    try {
      const storage = globalThis.localStorage;
      this.queue = JSON.parse(
        storage?.getItem(this.storageKey) ?? '[]'
      ) as ClientLogEvent[];
    } catch {
      this.queue = [];
    }
    this.scheduleRetry();
  }

  async write(event: ClientLogEvent) {
    if (this.disposed) return event.eventId ?? nanoid();
    const item = {
      ...event,
      eventId: event.eventId ?? nanoid(),
      metadata: sanitize(event.metadata) as Record<string, unknown> | undefined,
    };
    this.queue.push(item);
    while (this.queue.length > this.maxQueue) this.queue.shift();
    this.save();
    if (!this.retryTimer) await this.flush();
    return item.eventId;
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.disposed || !this.queue.length) return Promise.resolve();
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    // Install the guard before fetch can trigger more console/debug events.
    this.flushing = Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        this.flushing = undefined;
        this.scheduleRetry();
      });
    return this.flushing;
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.request?.abort();
  }

  private async drain() {
    while (this.queue.length && !this.disposed) {
      // Match the ingestion limit and never send a live, growing queue.
      const batch = this.queue.slice(0, 100);
      const sentIds = new Set(batch.map(event => event.eventId));
      const request = new AbortController();
      this.request = request;
      const timeout = setTimeout(() => request.abort(), 10000);
      try {
        const response = await fetch(
          `${this.endpoint.replace(/\/$/, '')}/api/logs/batch`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ events: batch }),
            signal: request.signal,
          }
        );
        if (!response.ok) return;
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== 'object' ||
          !('eventIds' in result) ||
          !Array.isArray(result.eventIds)
        )
          return;
        const accepted = new Set(
          result.eventIds.filter(
            (id): id is string => typeof id === 'string' && sentIds.has(id)
          )
        );
        for (let index = this.queue.length - 1; index >= 0; index--) {
          const eventId = this.queue[index].eventId;
          if (eventId && accepted.has(eventId)) this.queue.splice(index, 1);
        }
        this.save();
        // A partial receipt must not produce an immediate retry loop.
        if (accepted.size < sentIds.size) return;
        this.retryDelay = 1000;
      } catch {
        // Keep unacknowledged events for a bounded retry after an outage.
        return;
      } finally {
        clearTimeout(timeout);
        this.request = undefined;
      }
    }
  }

  private scheduleRetry() {
    if (this.disposed || !this.queue.length || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.flush().catch(() => undefined);
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30000);
  }

  get pending() {
    return this.queue.length;
  }

  private save() {
    try {
      globalThis.localStorage?.setItem(
        this.storageKey,
        JSON.stringify(this.queue)
      );
    } catch {
      /* storage unavailable */
    }
  }
}
