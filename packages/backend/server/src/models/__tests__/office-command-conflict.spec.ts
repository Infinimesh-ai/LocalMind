import test from 'ava';

import { projectCopilotTask } from '../../plugins/copilot/resolver';
import { isStaleOfficeCommandFailure } from '../common/office-command-conflict';
import { CopilotAgentRuntimeModel } from '../copilot-agent-runtime';

test('only an Office command with a revision conflict requires a new request', t => {
  const stale = {
    workflow: 'agent_runtime_office_command',
    status: 'failed',
    failureMessage: 'Office artifact revision conflict',
  };
  t.true(isStaleOfficeCommandFailure(stale));
  t.false(isStaleOfficeCommandFailure({ ...stale, status: 'queued' }));
  t.false(isStaleOfficeCommandFailure({ ...stale, workflow: 'other' }));
  t.false(
    isStaleOfficeCommandFailure({ ...stale, failureMessage: 'network error' })
  );
});

test('stale Office requests cannot resume and are not offered resume', async t => {
  const run = {
    workflow: 'agent_runtime_office_command',
    status: 'failed',
    failureMessage: 'Office artifact revision conflict',
    steps: [],
    timelineEvents: [],
    executionResults: [],
  };
  const projected = projectCopilotTask(run as never);
  t.deepEqual(projected.availableActions, ['abandon']);
  t.deepEqual(
    projectCopilotTask({ ...run, failureMessage: 'network error' } as never)
      .availableActions,
    ['resume', 'abandon']
  );
  const model = Object.create(CopilotAgentRuntimeModel.prototype) as {
    resumeStandaloneRun: (input: object, existing: object) => Promise<unknown>;
  };
  await t.throwsAsync(model.resumeStandaloneRun({}, run), {
    message: /Reopen the current file/,
  });
});
