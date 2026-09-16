import { PrismaClient } from '@prisma/client';

import {
  reconcileStaleMcpDelegations,
  retireToolContracts,
} from '../src/models/common/copilot-tool-contract-retirement';

const apply = process.argv.includes('--apply');
if (apply && process.env.LOCALMIND_WORKERS_PAUSED !== '1')
  throw new Error(
    'Pause all LocalMind workers and set LOCALMIND_WORKERS_PAUSED=1 before applying the tool contract cutover'
  );
const db = new PrismaClient();
try {
  const cutoffArg = process.argv.find(arg =>
    arg.startsWith('--reconcile-before=')
  );
  const cutoff = cutoffArg
    ? new Date(cutoffArg.slice('--reconcile-before='.length))
    : null;
  if (cutoff && apply) {
    const preview = await reconcileStaleMcpDelegations(db, cutoff);
    if (preview.unresolvedRequests)
      throw new Error(
        'Unclassified stale delegations require investigation before cutover'
      );
  }
  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'inspect',
      ...(await retireToolContracts(db, apply)),
      ...(cutoff
        ? {
            reconciliation: await reconcileStaleMcpDelegations(
              db,
              cutoff,
              apply
            ),
          }
        : {}),
    })
  );
} finally {
  await db.$disconnect();
}
