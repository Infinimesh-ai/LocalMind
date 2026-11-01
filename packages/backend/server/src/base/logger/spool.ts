import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  opendir,
  readdir,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';

export type SpoolRecord = Record<string, unknown> & { eventId: string };

export class SpoolCapacityError extends Error {
  constructor() {
    super('LocalMind log spool capacity reached');
    this.name = 'SpoolCapacityError';
  }
}

type SpoolUsage = { bytes: number; files: number };

/**
 * One process owns a spool directory. Committed size is scanned once, then kept
 * in memory so appends never re-scan a growing backlog; files remain the
 * evidence and the counters are rebuilt on restart.
 */
export class LocalMindLogSpool {
  readonly directory: string;
  private usage?: SpoolUsage;
  private usageScan?: Promise<SpoolUsage>;
  private reservedBytes = 0;
  private get lockDirectory() {
    return join(this.directory, '.flush-lock');
  }
  maxBytes: number;
  constructor(
    directory = process.env.LOCALMIND_LOG_SPOOL_DIR ??
      '/tmp/localmind-log-spool',
    maxBytes = Number(
      process.env.LOCALMIND_LOG_SPOOL_MAX_BYTES ?? 50 * 1024 * 1024
    )
  ) {
    this.directory = directory;
    this.maxBytes = maxBytes;
  }
  setMaxBytes(maxBytes: number) {
    this.maxBytes = Math.max(1024 * 1024, Math.floor(maxBytes));
  }
  async acquireFlushLease(): Promise<(() => Promise<void>) | null> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await mkdir(this.lockDirectory, { mode: 0o700 });
      await writeFile(join(this.lockDirectory, 'owner'), `${process.pid}\n`, {
        mode: 0o600,
      });
      return async () => {
        await unlink(join(this.lockDirectory, 'owner')).catch(() => undefined);
        await rmdir(this.lockDirectory).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        try {
          const info = await stat(this.lockDirectory);
          if (Date.now() - info.mtimeMs > 60_000) {
            await unlink(join(this.lockDirectory, 'owner')).catch(
              () => undefined
            );
            await rmdir(this.lockDirectory).catch(() => undefined);
            return await this.acquireFlushLease();
          }
        } catch {
          // A concurrent release may have removed the lock.
        }
        return null;
      }
      throw error;
    }
  }
  async append(record: SpoolRecord) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify(record);
    const checksum = createHash('sha256').update(payload).digest('hex');
    const envelope = JSON.stringify({ checksum, record: JSON.parse(payload) });
    const size = Buffer.byteLength(envelope);
    const usage = await this.committedUsage();
    // Reserve before the first await so concurrent appends cannot all pass.
    if (usage.bytes + this.reservedBytes + size > this.maxBytes) {
      throw new SpoolCapacityError();
    }
    this.reservedBytes += size;
    try {
      const file = join(this.directory, `${Date.now()}-${randomUUID()}.json`);
      await writeFile(`${file}.tmp`, envelope, {
        mode: 0o600,
      });
      await rename(`${file}.tmp`, file);
      usage.bytes += size;
      usage.files++;
      return file;
    } finally {
      this.reservedBytes -= size;
    }
  }
  /** Lists spool files; with a limit, stops reading the directory early. */
  async list(limit?: number) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (limit === undefined) {
      return (await readdir(this.directory))
        .filter(name => name.endsWith('.json'))
        .sort()
        .map(name => join(this.directory, name));
    }
    const names: string[] = [];
    if (limit <= 0) return names;
    // for-await closes the directory handle on completion, break or error.
    for await (const entry of await opendir(this.directory)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      names.push(entry.name);
      if (names.length >= limit) break;
    }
    return names.sort().map(name => join(this.directory, name));
  }
  async read(file: string): Promise<SpoolRecord> {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      checksum: string;
      record: SpoolRecord;
    };
    if (
      createHash('sha256')
        .update(JSON.stringify(parsed.record))
        .digest('hex') !== parsed.checksum
    )
      throw new Error('spool checksum mismatch');
    return parsed.record;
  }
  async remove(file: string) {
    // Wait for the initial scan so a file it already counted is subtracted once.
    const usage = await this.committedUsage();
    const size = await stat(file).then(
      info => info.size,
      () => undefined
    );
    await unlink(file);
    if (size !== undefined) {
      usage.bytes = Math.max(0, usage.bytes - size);
      usage.files = Math.max(0, usage.files - 1);
    }
  }
  /**
   * Moves pending files from another (legacy) spool directory into this one so
   * they are replayed; the source directory is removed once empty.
   */
  async adopt(source: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const usage = await this.committedUsage();
    let moved = 0;
    for await (const entry of await opendir(source)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = join(source, entry.name);
      const size = await stat(file).then(
        info => info.size,
        () => undefined
      );
      if (size === undefined) continue;
      await rename(file, join(this.directory, entry.name));
      usage.bytes += size;
      usage.files++;
      moved++;
    }
    await rmdir(source).catch(() => undefined);
    return moved;
  }
  /** Moves an unreadable file aside so it no longer blocks replay. */
  async quarantine(file: string) {
    const usage = await this.committedUsage();
    const size = await stat(file).then(
      info => info.size,
      () => undefined
    );
    const directory = join(this.directory, 'quarantine');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rename(file, join(directory, basename(file)));
    if (size !== undefined) {
      usage.bytes = Math.max(0, usage.bytes - size);
      usage.files = Math.max(0, usage.files - 1);
    }
    return true;
  }
  /** Committed bytes plus in-flight reservations, without a directory scan. */
  async bytes() {
    return (await this.committedUsage()).bytes + this.reservedBytes;
  }
  async files() {
    return (await this.committedUsage()).files;
  }
  private async committedUsage(): Promise<SpoolUsage> {
    if (this.usage) return this.usage;
    this.usageScan ??= this.scanUsage().then(
      usage => {
        this.usage ??= usage;
        this.usageScan = undefined;
        return this.usage;
      },
      error => {
        this.usageScan = undefined;
        throw error;
      }
    );
    return this.usageScan;
  }
  /** Streams the directory once; files removed during the scan are skipped. */
  private async scanUsage(): Promise<SpoolUsage> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const usage: SpoolUsage = { bytes: 0, files: 0 };
    for await (const entry of await opendir(this.directory)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const size = await stat(join(this.directory, entry.name)).then(
        info => info.size,
        () => undefined
      );
      if (size === undefined) continue;
      usage.bytes += size;
      usage.files++;
    }
    return usage;
  }
}
