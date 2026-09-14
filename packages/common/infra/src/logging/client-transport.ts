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
      if (!target) return;
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
  }

  async write(event: ClientLogEvent) {
    const item = {
      ...event,
      eventId: event.eventId ?? nanoid(),
      metadata: sanitize(event.metadata) as Record<string, unknown> | undefined,
    };
    this.queue.push(item);
    while (this.queue.length > this.maxQueue) this.queue.shift();
    this.save();
    await this.flush();
    return item.eventId;
  }

  async flush() {
    if (!this.queue.length) return;
    try {
      const response = await fetch(
        `${this.endpoint.replace(/\/$/, '')}/api/logs/batch`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ events: this.queue }),
        }
      );
      if (response.ok) this.queue.splice(0, this.queue.length);
      this.save();
    } catch {
      // Keep the bounded queue for retry when connectivity returns.
    }
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
