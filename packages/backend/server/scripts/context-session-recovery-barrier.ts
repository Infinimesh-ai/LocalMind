import { PrismaClient } from '@prisma/client';

import {
  type ContextSessionRecoveryBarrierMode,
  executeContextSessionRecoveryBarrier,
} from '../src/models/common/context-session-recovery-barrier';

const [mode, ...args] = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
if (!mode || !['export', 'verify', 'apply'].includes(mode) || !file) {
  throw new Error(
    'Usage: context-session-recovery-barrier.ts <export|verify|apply> --file <absolute-path>'
  );
}
const db = new PrismaClient();

try {
  console.log(
    JSON.stringify(
      await executeContextSessionRecoveryBarrier(
        db,
        mode as ContextSessionRecoveryBarrierMode,
        file
      )
    )
  );
} finally {
  await db.$disconnect();
}
