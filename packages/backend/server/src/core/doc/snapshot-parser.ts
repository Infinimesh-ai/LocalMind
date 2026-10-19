import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

import type { PageDocContent, WorkspaceDocContent } from '../utils/blocksuite';
import type {
  SnapshotResult,
  SnapshotTask,
  SnapshotView,
} from './snapshot-worker-types';

type Pending = {
  task: SnapshotTask;
  resolve: (value: SnapshotResult) => void;
  reject: (error: Error) => void;
  deadline: number;
  bytes: number;
};

// CPU-only work: workers never read storage or authorize an actor. Callers keep
// their current transaction/locks and supply its authoritative bytes.
export class SnapshotParser {
  private readonly queue: Pending[] = [];
  private readonly slots: Array<{ worker?: Worker; pending?: Pending }> = [
    {},
    {},
  ];
  private readonly cache = new Map<
    string,
    { value: SnapshotView; bytes: number }
  >();
  private readonly decoding = new Map<string, Promise<SnapshotView>>();
  private cacheBytes = 0;
  private closed = false;
  private pendingBytes = 0;

  private run(task: SnapshotTask): Promise<SnapshotResult> {
    if (this.closed) return Promise.reject(new Error('Document parser closed'));
    const bytes =
      task.kind === 'validate'
        ? [...task.updates, ...Object.values(task.snapshots)].reduce(
            (size, bin) => size + (bin?.byteLength ?? 0),
            0
          )
        : (task.bin?.byteLength ?? 0);
    if (
      this.queue.length >= 32 ||
      this.pendingBytes + bytes > 128 * 1024 * 1024
    )
      return Promise.reject(new Error('Document parser is busy; retry'));
    return new Promise((resolve, reject) => {
      this.pendingBytes += bytes;
      this.queue.push({
        task,
        resolve,
        reject,
        bytes,
        deadline: Date.now() + 10000,
      });
      this.dispatch();
    });
  }

  private dispatch() {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (slot.pending) continue;
      const pending = this.queue.shift();
      if (!pending) return;
      const remaining = pending.deadline - Date.now();
      if (remaining <= 0) {
        this.pendingBytes -= pending.bytes;
        pending.reject(new Error('Document parser is busy; retry'));
        this.dispatch();
        continue;
      }
      let worker: Worker;
      try {
        const workerUrl = new URL('./snapshot-worker.js', import.meta.url);
        worker = slot.worker ??= new Worker(workerUrl, {
          resourceLimits: { maxOldGenerationSizeMb: 256 },
        });
      } catch (error) {
        this.pendingBytes -= pending.bytes;
        pending.reject(
          error instanceof Error
            ? error
            : new Error('Document parser could not start')
        );
        this.dispatch();
        continue;
      }
      slot.pending = pending;
      worker.ref();
      const finish = (error?: Error, value: SnapshotResult = null) => {
        clearTimeout(timer);
        worker.removeListener('message', message);
        worker.removeListener('error', failed);
        worker.removeListener('exit', exited);
        slot.pending = undefined;
        this.pendingBytes -= pending.bytes;
        if (error) {
          slot.worker = undefined;
          worker.terminate().catch(() => {});
          pending.reject(error);
        } else {
          worker.unref();
          pending.resolve(value);
        }
        this.dispatch();
      };
      const message = (result: { value?: SnapshotResult; error?: string }) => {
        // A validation rejection does not require replacing a healthy worker.
        if (result.error) {
          pending.reject(new Error(result.error));
          finish();
        } else finish(undefined, result.value ?? null);
      };
      const failed = (error: Error) => finish(error);
      const exited = () => finish(new Error('Document parser stopped; retry'));
      const timer = setTimeout(
        () =>
          finish(new Error('Document parser exceeded its work budget; retry')),
        remaining
      );
      worker.once('message', message);
      worker.once('error', failed);
      worker.once('exit', exited);
      try {
        worker.postMessage(pending.task);
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error('Invalid document parser task')
        );
      }
    }
  }

  async decode(scope: string, bin: Uint8Array | null): Promise<SnapshotView> {
    const key = JSON.stringify([
      scope,
      bin ? createHash('sha256').update(bin).digest('hex') : null,
    ]);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return structuredClone(cached.value);
    }
    let pending = this.decoding.get(key);
    if (!pending) {
      pending = this.run({ kind: 'decode', bin })
        .then(value => {
          if (!value || !('maps' in value))
            throw new Error('Invalid document parser response');
          const bytes = Buffer.byteLength(JSON.stringify(value));
          if (bytes <= 4 * 1024 * 1024) {
            while (
              this.cache.size >= 64 ||
              this.cacheBytes + bytes > 16 * 1024 * 1024
            ) {
              const oldest = this.cache.entries().next().value;
              if (!oldest) break;
              this.cache.delete(oldest[0]);
              this.cacheBytes -= oldest[1].bytes;
            }
            this.cache.set(key, { value, bytes });
            this.cacheBytes += bytes;
          }
          return value;
        })
        .finally(() => this.decoding.delete(key));
      this.decoding.set(key, pending);
    }
    return structuredClone(await pending);
  }

  async validate(
    task: Omit<Extract<SnapshotTask, { kind: 'validate' }>, 'kind'>
  ) {
    await this.run({ ...task, kind: 'validate' });
  }

  async pageContent(
    bin: Uint8Array,
    maxSummaryLength: number
  ): Promise<PageDocContent | null> {
    const value = await this.run({
      kind: 'pageContent',
      bin,
      maxSummaryLength,
    });
    if (value === null || 'summary' in value) return value;
    throw new Error('Invalid document parser response');
  }

  async workspaceContent(bin: Uint8Array): Promise<WorkspaceDocContent | null> {
    const value = await this.run({ kind: 'workspaceContent', bin });
    if (value === null || 'avatarKey' in value) return value;
    throw new Error('Invalid document parser response');
  }

  async docIds(bin: Uint8Array, includeTrash = false): Promise<string[]> {
    const value = await this.run({ kind: 'docIds', bin, includeTrash });
    if (Array.isArray(value)) return value;
    throw new Error('Invalid document parser response');
  }

  async close() {
    this.closed = true;
    for (const pending of this.queue.splice(0)) {
      this.pendingBytes -= pending.bytes;
      pending.reject(new Error('Document parser closed'));
    }
    this.cache.clear();
    this.cacheBytes = 0;
    await Promise.all(
      this.slots.map(async slot => {
        const worker = slot.worker;
        slot.worker = undefined;
        await worker?.terminate();
      })
    );
  }
}

export const snapshotParser = new SnapshotParser();
