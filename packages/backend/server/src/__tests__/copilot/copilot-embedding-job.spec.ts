import { PrismaClient } from '@prisma/client';
import test from 'ava';

import type { EventBus, JobQueue } from '../../base';
import type { DocReader } from '../../core/doc';
import type { WorkspaceBlobStorage } from '../../core/storage';
import type { Models } from '../../models';
import { addDocToRootDoc } from '../../native';
import {
  CopilotEmbeddingClientService,
  CopilotEmbeddingJob,
} from '../../plugins/copilot/embedding';
import type { CopilotStorage } from '../../plugins/copilot/storage';

test('workspace embedding root scan bypasses inherited model transaction', async t => {
  const queued: Array<{ name: string; payload: unknown; options: unknown }> =
    [];
  let rootLookup: unknown;
  const models = {
    copilotContext: {
      checkEmbeddingAvailable: async () => true,
    },
    copilotWorkspace: {
      findDocsToEmbed: async () => ['live-doc', 'trashed-doc'],
    },
    workspace: {
      allowEmbedding: async () => true,
    },
    doc: {
      getSnapshot: async () => {
        throw new Error('Transaction already closed');
      },
    },
  } as unknown as Models;
  const database = {
    snapshot: {
      findUnique: async (input: unknown) => {
        rootLookup = input;
        return {
          blob: addDocToRootDoc(Buffer.from([0, 0]), 'live-doc', 'Live doc'),
        };
      },
    },
  } as unknown as PrismaClient;
  const queue = {
    add: async (name: string, payload: unknown, options: unknown) => {
      queued.push({ name, payload, options });
    },
  } as unknown as JobQueue;
  const embeddingClients = {
    refresh: async () => ({ configured: async () => true }),
  } as unknown as CopilotEmbeddingClientService;
  const job = new CopilotEmbeddingJob(
    embeddingClients,
    {} as DocReader,
    {} as EventBus,
    models,
    queue,
    {} as CopilotStorage,
    {} as WorkspaceBlobStorage,
    database
  );

  await job.onConfigInit();
  await job.addWorkspaceEmbeddingQueue({
    workspaceId: 'workspace-1',
    enableDocEmbedding: true,
  });

  t.deepEqual(rootLookup, {
    where: {
      workspaceId_id: {
        workspaceId: 'workspace-1',
        id: 'workspace-1',
      },
    },
    select: { blob: true },
  });
  t.deepEqual(queued, [
    {
      name: 'copilot.embedding.docs',
      payload: { workspaceId: 'workspace-1', docId: 'live-doc' },
      options: {
        jobId: 'workspace:embedding:workspace-1:live-doc',
        priority: 1,
      },
    },
  ]);
});
