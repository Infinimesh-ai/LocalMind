import { PrismaClient } from '@prisma/client';

import { retireToolContracts } from '../src/models/common/copilot-tool-contract-retirement';

const apply = process.argv.includes('--apply');
if (apply && process.env.LOCALMIND_WORKERS_PAUSED !== '1')
  throw new Error(
    'Pause all LocalMind workers and set LOCALMIND_WORKERS_PAUSED=1 before applying the tool contract cutover'
  );
const db = new PrismaClient();
try {
  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'inspect',
      ...(await retireToolContracts(db, apply)),
    })
  );
} finally {
  await db.$disconnect();
}
