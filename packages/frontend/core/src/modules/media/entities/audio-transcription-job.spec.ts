/** @vitest-environment happy-dom */

import type { TranscriptionBlockProps } from '@affine/core/blocksuite/ai/blocks/transcription-block/model';
import { AiJobStatus, retryTranscriptTaskMutation } from '@affine/graphql';
import { Framework, LiveData } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import { AuthService } from '../../cloud/services/auth';
import { DefaultServerService } from '../../cloud/services/default-server';
import { GraphQLService } from '../../cloud/services/graphql';
import { WorkspaceServerService } from '../../cloud/services/workspace-server';
import { NbstoreService } from '../../storage';
import { WorkspaceService } from '../../workspace';
import { AudioTranscriptionJob } from './audio-transcription-job';
import { AudioTranscriptionJobStore } from './audio-transcription-job-store';

function createJob({
  currentUserId = 'user-1',
  createdBy = 'user-1',
  request,
  gql = vi.fn(),
}: {
  currentUserId?: string;
  createdBy?: string;
  request: ReturnType<typeof vi.fn>;
  gql?: ReturnType<typeof vi.fn>;
}) {
  const server = {
    scope: {
      get: (key: unknown) => (key === GraphQLService ? { gql } : null),
      getOptional: (key: unknown) =>
        key === AuthService
          ? { session: { account$: new LiveData({ id: currentUserId }) } }
          : null,
    },
  };
  const framework = new Framework();
  framework
    .service(WorkspaceService, {
      workspace: { id: 'workspace-1' },
    } as WorkspaceService)
    .service(WorkspaceServerService, {
      server,
    } as unknown as WorkspaceServerService)
    .service(DefaultServerService, {
      server: null,
    } as unknown as DefaultServerService)
    .service(NbstoreService, {
      realtime: { request },
    } as unknown as NbstoreService)
    .entity(AudioTranscriptionJobStore, [
      WorkspaceService,
      WorkspaceServerService,
      DefaultServerService,
      NbstoreService,
    ])
    .entity(AudioTranscriptionJob, [
      WorkspaceServerService,
      DefaultServerService,
    ]);

  return framework.provider().createEntity(AudioTranscriptionJob, {
    blobId: 'blob-1',
    blockProps: {
      jobId: 'task-1',
      createdBy,
    } as TranscriptionBlockProps,
    getAudioTranscriptionInput: async () => ({ files: [] }),
  });
}

describe('AudioTranscriptionJob', () => {
  test('only retries a failed task after explicit user intent', async () => {
    const request = vi.fn().mockResolvedValue({
      task: { id: 'task-1', status: AiJobStatus.failed },
    });
    const gql = vi.fn().mockResolvedValue({
      retryTranscriptTask: { id: 'task-1', status: AiJobStatus.failed },
    });
    const job = createJob({ request, gql });

    const resumed = await job.start(false);

    expect(resumed.status).toBe(AiJobStatus.failed);
    expect(request).toHaveBeenCalledTimes(1);
    expect(gql).not.toHaveBeenCalled();

    const [first, second] = await Promise.all([
      job.start(true),
      job.start(true),
    ]);

    expect(first.status).toBe(AiJobStatus.failed);
    expect(second).toBe(first);
    expect(request).toHaveBeenCalledTimes(2);
    expect(gql).toHaveBeenCalledTimes(1);
    expect(gql).toHaveBeenCalledWith({
      query: retryTranscriptTaskMutation,
      variables: {
        workspaceId: 'workspace-1',
        taskId: 'task-1',
      },
    });
  });

  test('checks ownership inside the single-flight start operation', async () => {
    const request = vi.fn().mockResolvedValue({ task: null });
    const gql = vi.fn();
    const job = createJob({
      currentUserId: 'user-2',
      createdBy: 'user-1',
      request,
      gql,
    });

    const result = await job.start(true);

    expect(result).toEqual({
      status: 'blocked',
      error: 'created-by-others',
      userId: 'user-1',
    });
    expect(job.status$.value.status).toBe('waiting-for-job');
    expect(request).toHaveBeenCalledTimes(1);
    expect(gql).not.toHaveBeenCalled();
  });
});
