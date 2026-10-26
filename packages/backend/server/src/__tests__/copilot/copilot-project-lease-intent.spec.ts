import test from 'ava';

import type { ProjectResourceService } from '../../core/project';
import type { Models } from '../../models';
import { executeToolCall } from '../../plugins/copilot/runtime/tool/bridge';
import { createProjectResourceTools } from '../../plugins/copilot/tools/project-doc';

const edits = {
  project_doc_update: {
    doc_id: 'resource',
    expected_content_version: 1,
    content: 'new body',
  },
  project_file_update: {
    resource_id: 'resource',
    expected_content_version: 1,
    text: 'new body',
  },
  project_resource_update_meta: {
    resource_id: 'resource',
    expected_version: 1,
    title: 'renamed',
  },
  project_resource_restore_version: {
    resource_id: 'resource',
    expected_content_version: 1,
    sequence: 1,
  },
};

for (const [name, args] of Object.entries(edits)) {
  for (const policy of ['fail', 'wait', null, undefined] as const) {
    test(`${name} freezes ${String(policy)} editing intent through the bridge`, async t => {
      let savedCommand: Record<string, unknown> | undefined;
      const models = {
        copilotSession: {
          getMeta: async () => ({
            userId: 'actor',
            selectedContextProjectId: 'project',
          }),
        },
        projectResource: {
          assertMember: async () => {},
          get: async () => ({ title: 'Resource' }),
        },
        copilotProjectAgentRuntime: {
          prepare: async (input: { command: Record<string, unknown> }) => {
            savedCommand = input.command;
            return { id: 'run', status: 'queued', projectExecutionResults: [] };
          },
          acquire: async () => ({ workerAttempt: 1 }),
          waitForEditLease: async () => ({
            status:
              savedCommand?.editLeaseConflictPolicy === 'fail'
                ? 'failed'
                : 'waiting_lease',
          }),
        },
        projectResourceEditLease: {
          acquire: async () => ({
            acquired: false,
            lease: { leaseId: 'editor' },
          }),
          releaseTask: async () => {},
        },
      } as unknown as Models;
      const tools = createProjectResourceTools(
        models,
        {} as ProjectResourceService,
        {
          user: 'actor',
          session: 'session',
          tools: ['docUpdate', 'docUpdateMeta'],
        },
        'project'
      );
      const result = await executeToolCall(
        tools,
        {
          name,
          callId: 'conflicting-edit',
          args: {
            ...args,
            ...(policy !== undefined ? { lease_conflict: policy } : {}),
          },
        },
        {}
      );
      t.not(result.isError, true);
      t.is(savedCommand?.editLeaseConflictPolicy, policy ?? 'wait');
      t.like(result.output, {
        status: policy === 'fail' ? 'failed' : 'waiting_lease',
        applied: false,
        final: policy === 'fail',
        automaticRetryScheduled: policy !== 'fail',
      });
    });
  }
}
