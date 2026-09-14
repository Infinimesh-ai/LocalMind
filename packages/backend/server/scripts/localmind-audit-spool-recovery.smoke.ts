import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Env } from '../src/env';

globalThis.env ??= new Env();
const { LocalMindLogService } =
  await import('../src/base/logger/localmind-log-service');
const directory = await mkdtemp(join(tmpdir(), 'localmind-audit-spool-'));
process.env.LOCALMIND_LOG_SPOOL_DIR = directory;
let fail = true;
let envelopes = 0;
const prisma = {
  localMindAuditEnvelope: {
    findUnique: async () => null,
    create: async () => {
      envelopes++;
    },
  },
  localMindLogEvent: { create: async () => undefined },
  $transaction: async (callback: (tx: any) => Promise<void>) => {
    if (fail) {
      fail = false;
      throw new Error('postgres unavailable');
    }
    return callback(prisma as any);
  },
};
const service = new LocalMindLogService(prisma as any);
let rejected = false;
try {
  await service.writeAudit({
    auditEventId: 'audit-recovery',
    action: 'settings.update',
    outcome: 'success',
  });
} catch {
  rejected = true;
}
if (!rejected || (await service.spoolStatus()).files < 1) {
  throw new Error('audit was not durably spooled');
}
await service.flushSpool(10);
if (envelopes !== 1)
  throw new Error(`audit envelope recovery failed: ${envelopes}`);
console.log('audit spool recovery and envelope replay verified');
