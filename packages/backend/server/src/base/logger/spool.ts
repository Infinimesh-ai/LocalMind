import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

export type SpoolRecord = Record<string, unknown> & { eventId: string };

export class SpoolCapacityError extends Error {
  constructor() {
    super('LocalMind log spool capacity reached');
    this.name = 'SpoolCapacityError';
  }
}

export class LocalMindLogSpool {
  readonly directory: string;
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
    if ((await this.bytes()) + Buffer.byteLength(envelope) > this.maxBytes) {
      throw new SpoolCapacityError();
    }
    const file = join(this.directory, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(`${file}.tmp`, envelope, {
      mode: 0o600,
    });
    await rename(`${file}.tmp`, file);
    return file;
  }
  async list() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return (await readdir(this.directory))
      .filter(name => name.endsWith('.json'))
      .sort()
      .map(name => join(this.directory, name));
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
    await unlink(file);
  }
  async bytes() {
    let total = 0;
    for (const file of await this.list()) total += (await stat(file)).size;
    return total;
  }
}
