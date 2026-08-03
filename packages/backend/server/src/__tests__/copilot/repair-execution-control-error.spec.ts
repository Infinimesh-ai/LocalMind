import test from 'ava';

import { BadRequest } from '../../base';
import { RepairExecutionControlError } from '../../models/copilot-repair-execution';

test('repair execution control errors have an explicit user-facing boundary', t => {
  const controlError = new RepairExecutionControlError(
    'Repair execution request is not waiting for approval'
  );
  const invariantError = new Error(
    'Updated repair execution request not found after approval'
  );

  t.true(controlError instanceof BadRequest);
  t.false(invariantError instanceof BadRequest);
});
