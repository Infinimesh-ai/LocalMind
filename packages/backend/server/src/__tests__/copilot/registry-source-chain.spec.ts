import test from 'ava';
import Sinon from 'sinon';

import { warnUnknownRegistrySourceChainStatuses } from '../../models/copilot-registry-source-chain-logging';

test('registry source-chain normalization warns when an unknown status is dropped', t => {
  const logger = { warn: Sinon.spy() };

  warnUnknownRegistrySourceChainStatuses({
    allowedStatuses: new Set(['active', 'prepared_for_approval']),
    logger,
    registryKind: 'task route policy registry',
    value: [
      { status: 'prepared_for_approval' },
      { status: 'future_unrecognized_status' },
    ],
  });

  t.true(
    logger.warn.calledOnceWith(
      'Dropped task route policy registry source-chain entry with unknown status "future_unrecognized_status"'
    )
  );
});
