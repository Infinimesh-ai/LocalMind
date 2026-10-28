import { stat } from 'node:fs/promises';

import { PrismaClient } from '@prisma/client';

import { repairLegacyMemoryKeys } from '../src/models/common/context-memory-legacy-repair';

const option = (name: string) =>
  process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const apply = process.argv.includes('--apply');
if (apply) {
  const backup = process.env.LOCALMIND_DATABASE_BACKUP;
  if (
    process.env.LOCALMIND_WORKERS_PAUSED !== '1' ||
    !backup ||
    !(await stat(backup)).size
  ) {
    throw new Error(
      'Applying memory repair requires paused workers and a nonempty database backup'
    );
  }
  if (!option('--fingerprint') || !option('--actor'))
    throw new Error('Apply requires the inspected fingerprint and actor');
}
const db = new PrismaClient();
try {
  console.log(
    JSON.stringify(
      await repairLegacyMemoryKeys(
        db,
        apply
          ? {
              expectedFingerprint: option('--fingerprint'),
              actorId: option('--actor'),
            }
          : {}
      ),
      null,
      2
    )
  );
} finally {
  await db.$disconnect();
}
