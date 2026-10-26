import { UserFriendlyError } from '@affine/error';
export type ProjectUploadJob = { requestKey: string };

/** One queue spans all drops and retries, including overlapping selections. */
export class ProjectUploadQueue<T extends ProjectUploadJob> {
  private readonly waiting = new Map<string, T>();
  private readonly active = new Map<string, AbortController>();
  private disposed = false;
  private pausedUntil = 0;
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private readonly throttleRetries = new Map<string, number>();

  constructor(
    private readonly execute: (job: T, signal: AbortSignal) => Promise<void>,
    private readonly onError: (job: T, error: unknown) => void,
    private readonly concurrency = 3,
    private readonly onThrottled?: (job: T, delayMs: number) => void
  ) {}

  enqueue(jobs: T[]) {
    if (this.disposed) return;
    for (const job of jobs) {
      if (!this.active.has(job.requestKey))
        this.waiting.set(job.requestKey, job);
    }
    this.pump();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.wakeTimer);
    this.waiting.clear();
    for (const controller of this.active.values()) controller.abort();
  }

  private pump() {
    if (this.disposed) return;
    const delay = this.pausedUntil - Date.now();
    if (delay > 0) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = setTimeout(() => this.pump(), delay);
      return;
    }
    while (!this.disposed && this.active.size < this.concurrency) {
      const job = this.waiting.values().next().value;
      if (!job) return;
      this.waiting.delete(job.requestKey);
      const controller = new AbortController();
      this.active.set(job.requestKey, controller);
      void this.execute(job, controller.signal)
        .then(() => this.throttleRetries.delete(job.requestKey))
        .catch(error => {
          if (controller.signal.aborted) return;
          const friendly = UserFriendlyError.fromAny(error);
          const retries = this.throttleRetries.get(job.requestKey) ?? 0;
          if (
            (friendly.status === 429 || friendly.is('TOO_MANY_REQUEST')) &&
            retries < 5
          ) {
            const delayMs = friendly.retryAfterMs ?? 60_000;
            this.throttleRetries.set(job.requestKey, retries + 1);
            this.waiting.set(job.requestKey, job);
            this.pausedUntil = Math.max(this.pausedUntil, Date.now() + delayMs);
            this.onThrottled?.(job, delayMs);
            return;
          }
          this.throttleRetries.delete(job.requestKey);
          this.onError(job, error);
        })
        .finally(() => {
          this.active.delete(job.requestKey);
          this.pump();
        });
    }
  }
}
