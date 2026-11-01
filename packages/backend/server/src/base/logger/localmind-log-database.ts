import { Injectable, type OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { Config } from '../config';

const DEFAULT_CONNECTION_LIMIT = 3;
const DEFAULT_POOL_TIMEOUT_SECONDS = 5;

/**
 * Applies a small, explicit pool to the log database URL. Returns undefined when
 * the URL cannot be parsed so callers fall back to the shared client.
 */
export function localMindLogDatabaseUrl(
  url: string | undefined,
  connectionLimit = Number(
    process.env.LOCALMIND_LOG_DB_CONNECTION_LIMIT ?? DEFAULT_CONNECTION_LIMIT
  )
) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const limit =
      Number.isInteger(connectionLimit) && connectionLimit > 0
        ? connectionLimit
        : DEFAULT_CONNECTION_LIMIT;
    parsed.searchParams.set('connection_limit', String(limit));
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set(
        'pool_timeout',
        String(DEFAULT_POOL_TIMEOUT_SECONDS)
      );
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/**
 * Runtime log ingestion, spool replay and retention use their own small pool so
 * a slow log table cannot occupy the business connection pool. The pool does
 * not isolate disk or CPU; the writer still bounds its own batch rate.
 */
@Injectable()
export class LocalMindLogDatabase implements OnModuleDestroy {
  readonly client: PrismaClient;
  private readonly owned: boolean;

  constructor(prisma: PrismaClient, @Optional() config?: Config) {
    const shared = config?.db.prisma ?? {};
    // A custom datasources map cannot be re-pointed safely; share the client.
    const url =
      process.env.LOCALMIND_LOG_DB_SHARED_POOL === 'true' || shared.datasources
        ? undefined
        : localMindLogDatabaseUrl(
            shared.datasourceUrl ??
              process.env.DATABASE_URL ??
              config?.db.datasourceUrl
          );
    this.owned = !!url;
    if (!url) {
      this.client = prisma;
      return;
    }
    const { datasourceUrl: _datasourceUrl, ...options } = shared;
    this.client = new PrismaClient({ ...options, datasourceUrl: url });
  }

  async onModuleDestroy() {
    if (this.owned) await this.client.$disconnect();
  }
}
