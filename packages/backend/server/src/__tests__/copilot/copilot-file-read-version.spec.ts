import test from 'ava';

import type { WorkspaceNativeResourceService } from '../../core/office/workspace-resource-service';
import type { ProjectResourceService } from '../../core/project';
import type { Models } from '../../models';
import { executeToolCall } from '../../plugins/copilot/runtime/tool/bridge';
import { createProjectResourceTools } from '../../plugins/copilot/tools/project-doc';
import { createWorkspaceNativeTools } from '../../plugins/copilot/tools/workspace-native';

for (const owner of ['project', 'workspace'] as const) {
  for (const requested of [undefined, null, 1] as const) {
    test(`${owner} file read resolves ${String(requested)} to the intended immutable version`, async t => {
      let received: number | undefined;
      const read = async ({ sequence }: { sequence?: number }) => {
        received = sequence;
        return {
          contentVersion: sequence ?? 6,
          text: sequence === 1 ? 'Old value' : 'Current value',
        };
      };
      const models = {
        copilotSession: {
          getMeta: async () => ({
            userId: 'actor',
            ...(owner === 'workspace'
              ? { workspaceId: 'workspace' }
              : { selectedContextProjectId: 'project' }),
          }),
        },
        projectResource: {
          assertMember: async () => {},
          get: async () => ({ title: 'File', contentVersion: 6 }),
          path: async () => [],
        },
        copilotContext: { recordInputSources: async () => {} },
      } as unknown as Models;
      const options = {
        user: 'actor',
        session: 'session',
        tools: ['docRead'] as ['docRead'],
      };
      const tools =
        owner === 'project'
          ? createProjectResourceTools(
              models,
              {
                readTextFile: async (input: { sequence?: number }) => {
                  const value = await read(input);
                  return {
                    ...value,
                    revision: { sequence: value.contentVersion },
                    resource: { contentVersion: 6 },
                    blob: { byteSize: 10 },
                  };
                },
              } as unknown as ProjectResourceService,
              options,
              'project'
            )
          : createWorkspaceNativeTools(
              models,
              { readText: read } as unknown as WorkspaceNativeResourceService,
              { ...options, workspace: 'workspace' },
              true
            );
      const result = await executeToolCall(
        tools,
        {
          name: `${owner}_file_read`,
          callId: 'read-current',
          args: {
            resource_id: 'file',
            ...(requested !== undefined
              ? {
                  [owner === 'project' ? 'content_version' : 'sequence']:
                    requested,
                }
              : {}),
          },
        },
        {}
      );
      t.not(result.isError, true);
      t.is(received, requested ?? undefined);
      t.like(result.output, {
        contentVersion: requested ?? 6,
        text: requested === 1 ? 'Old value' : 'Current value',
        complete: true,
      });
      if (owner === 'project')
        t.like(result.output, {
          currentContentVersion: 6,
          historical: requested === 1,
        });
      else t.like(result.output, { url: '/workspace/workspace/files/file' });
    });
  }
}

test('workspace resource discovery provides typed routes without changing domain receipts', async t => {
  const items = [
    { id: 'office/id', kind: 'office', title: 'Report.docx' },
    { id: 'file id', kind: 'file', title: 'Data.csv' },
  ];
  const tools = createWorkspaceNativeTools(
    {
      copilotSession: {
        getMeta: async () => ({ userId: 'actor', workspaceId: 'workspace' }),
      },
    } as unknown as Models,
    {
      list: async () => ({ items, nextCursor: 'next' }),
    } as unknown as WorkspaceNativeResourceService,
    {
      user: 'actor',
      session: 'session',
      workspace: 'workspace',
      tools: ['docRead'],
    },
    false
  );
  const result = await executeToolCall(
    tools,
    {
      name: 'workspace_resource_list',
      callId: 'list',
      args: {},
    },
    {}
  );
  t.not(result.isError, true);
  t.deepEqual(result.output, {
    items: [
      { ...items[0], url: '/workspace/workspace/office/office%2Fid' },
      { ...items[1], url: '/workspace/workspace/files/file%20id' },
    ],
    nextCursor: 'next',
  });
  t.false('url' in items[0]);
});
