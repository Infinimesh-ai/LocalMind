import { Readable } from 'node:stream';

import { AiJobStatus } from '@prisma/client';
import test from 'ava';
import Sinon from 'sinon';

import { backfillTranscriptStorageKeys } from '../../data/migrations/1786805802350-backfill-transcript-storage-keys';
import { CopilotStorage } from '../../plugins/copilot/storage';
import {
  buildLegacyProjection,
  normalizeTranscriptResultTimestamps,
  normalizeTranscriptSegments,
} from '../../plugins/copilot/transcript/projection';
import {
  AudioBlobInfosSchema,
  TranscriptPayloadSchema,
} from '../../plugins/copilot/transcript/schema';
import { CopilotTranscriptionService } from '../../plugins/copilot/transcript/service';

test('buildLegacyProjection backfills summary, actions and transcription', t => {
  const legacy = buildLegacyProjection({
    normalizedSegments: [
      {
        speaker: 'A',
        startSec: 10,
        endSec: 12,
        start: '00:00:10',
        end: '00:00:12',
        text: 'Kickoff',
      },
    ],
    summaryJson: {
      title: 'Weekly Sync',
      durationMinutes: 30,
      attendees: ['A', 'B'],
      keyPoints: ['Reviewed launch status'],
      actionItems: [
        {
          description: 'Send recap',
          owner: 'A',
          deadline: 'Friday',
        },
      ],
      decisions: ['Ship on Monday'],
      openQuestions: ['Need final QA sign-off'],
      blockers: ['Missing analytics dashboard'],
    },
  });

  t.is(legacy.title, 'Weekly Sync');
  t.true(legacy.summary?.includes('Reviewed launch status') ?? false);
  t.true(legacy.summary?.includes('## Decisions') ?? false);
  t.is(legacy.actions, '- [ ] Send recap (A · Friday)');
  t.deepEqual(legacy.transcription, [
    {
      speaker: 'A',
      start: '00:00:10',
      end: '00:00:12',
      transcription: 'Kickoff',
    },
  ]);
});

test('normalizeTranscriptSegments sorts, trims and removes invalid overlaps', t => {
  const normalized = normalizeTranscriptSegments([
    {
      sliceIndex: 1,
      speaker: ' B ',
      startSec: 8,
      endSec: 12,
      text: ' Follow-up ',
    },
    {
      sliceIndex: 0,
      speaker: 'A',
      startSec: 2,
      endSec: 6,
      text: 'Kickoff',
    },
    {
      sliceIndex: 0,
      speaker: 'A',
      startSec: 2,
      endSec: 6,
      text: 'Kickoff',
    },
    {
      sliceIndex: 2,
      speaker: 'C',
      startSec: 5,
      endSec: 5,
      text: 'Invalid',
    },
  ]);

  t.deepEqual(normalized, [
    {
      speaker: 'A',
      startSec: 2,
      endSec: 6,
      start: '00:00:02',
      end: '00:00:06',
      text: 'Kickoff',
    },
    {
      speaker: 'B',
      startSec: 8,
      endSec: 12,
      start: '00:00:08',
      end: '00:00:12',
      text: 'Follow-up',
    },
  ]);
});

test('normalizes MMSS and millisecond transcript timestamps', t => {
  const mmss = normalizeTranscriptResultTimestamps({
    sourceAudio: { durationMs: 120_000 },
    normalizedSegments: [
      {
        speaker: 'A',
        startSec: 100,
        endSec: 130,
        start: 'invalid',
        end: 'invalid',
        text: 'Kickoff',
      },
      {
        speaker: 'B',
        startSec: 130,
        endSec: 200,
        start: 'invalid',
        end: 'invalid',
        text: 'Wrap-up',
      },
    ],
  });
  const milliseconds = normalizeTranscriptResultTimestamps({
    sourceAudio: { durationMs: 10_000 },
    normalizedSegments: [
      {
        speaker: 'A',
        startSec: 5_000,
        endSec: 9_000,
        start: 'invalid',
        end: 'invalid',
        text: 'Milliseconds',
      },
    ],
  });

  t.deepEqual(
    mmss.normalizedSegments?.map(segment => [
      segment.startSec,
      segment.endSec,
      segment.start,
      segment.end,
    ]),
    [
      [60, 90, '00:01:00', '00:01:30'],
      [90, 120, '00:01:30', '00:02:00'],
    ]
  );
  t.like(milliseconds.normalizedSegments?.[0] ?? {}, {
    startSec: 5,
    endSec: 9,
    start: '00:00:05',
    end: '00:00:09',
  });
});

test('TranscriptPayloadSchema rejects empty payloads', t => {
  const emptyError = t.throws(() => TranscriptPayloadSchema.parse({}));
  t.truthy(emptyError);

  const unknownOnlyError = t.throws(() =>
    TranscriptPayloadSchema.parse({ foo: 'bar' })
  );
  t.truthy(unknownOnlyError);
});

test('TranscriptPayloadSchema accepts stable keys and legacy URL-only infos', t => {
  const infos = AudioBlobInfosSchema.parse([
    {
      key: 'blob-1-0',
      url: 'https://example.com/api/copilot/blob/user-1/workspace-1/blob-1-0',
      mimeType: 'audio/opus',
    },
    {
      url: 'data:audio/opus;base64,YXVkaW8=',
      mimeType: 'audio/opus',
    },
  ]);

  t.is(infos[0].key, 'blob-1-0');
  t.is(infos[1].key, undefined);
});

test('CopilotStorage extracts only workspace-scoped keys from URLs', t => {
  const storage = new CopilotStorage({} as never, {} as never, {} as never);

  t.is(
    storage.keyFromUrl(
      'user-1',
      'workspace-1',
      'https://localmind.test/api/copilot/blob/user-1/workspace-1/blob%2Fpart-0?token=old'
    ),
    'blob/part-0'
  );
  t.is(
    storage.keyFromUrl(
      'user-1',
      'workspace-1',
      'https://localmind.test/api/copilot/blob/user-2/workspace-1/blob-1-0'
    ),
    undefined
  );
});

test('transcript storage key backfill preserves URLs and existing keys', t => {
  const payload = {
    normalizedTranscript: '00:00:01 A: Hello',
    infos: [
      {
        url: 'https://localmind.test/api/copilot/blob/user-1/workspace-1/blob-1-0',
        mimeType: 'audio/opus',
      },
      {
        key: 'already-present',
        url: 'https://example.com/external',
        mimeType: 'audio/opus',
      },
    ],
  };

  const result = backfillTranscriptStorageKeys(
    payload,
    'user-1',
    'workspace-1'
  ) as typeof payload & { infos: Array<{ key?: string; url: string }> };

  t.is(result.infos[0].key, 'blob-1-0');
  t.is(result.infos[0].url, payload.infos[0].url);
  t.is(result.infos[1].key, 'already-present');
});

function createTranscriptPromptService() {
  return {
    get: Sinon.stub().resolves({ name: 'Transcript audio structured' }),
    finish: Sinon.stub().callsFake((_prompt, params) => [
      {
        role: 'user',
        content: params.content,
      },
    ]),
  };
}

async function buildNativeTranscriptResult(input: any, runId: string) {
  await input.onRunCreated?.({ runId, attempt: 1 });
  const nativeInput = input.nativeInput;
  return {
    nativeInput,
    result: {
      sourceAudio: nativeInput.input.sourceAudio ?? null,
      quality: nativeInput.input.quality ?? null,
      infos: [{ url: 'about:invalid', mimeType: 'text/plain', index: 0 }],
      sliceManifest: null,
      normalizedSegments: [
        {
          speaker: 'A',
          startSec: 5,
          endSec: 9,
          start: '00:00:05',
          end: '00:00:09',
          text: 'Kickoff',
        },
      ],
      normalizedTranscript: '00:00:05 A: Kickoff',
      summaryJson: {
        title: 'Weekly Sync',
        durationMinutes: 1,
        attendees: ['A'],
        keyPoints: ['Kickoff'],
        actionItems: [],
        decisions: [],
        openQuestions: [],
        blockers: [],
      },
      providerMeta: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
      version: 'transcript-result-v1',
      strategy: 'gemini',
    },
  };
}

function createSuccessfulTranscriptBridge(
  runId: string,
  bridgeInputs: unknown[]
) {
  return {
    runStream: (input: unknown) =>
      (async function* () {
        const { nativeInput, result } = await buildNativeTranscriptResult(
          input,
          runId
        );
        bridgeInputs.push({
          ...(input as Record<string, unknown>),
          nativeInput,
        });
        yield {
          type: 'action_done' as const,
          actionId: 'transcript.audio.gemini',
          actionVersion: 'v1',
          status: 'succeeded' as const,
          runId,
          result,
        };
      })(),
  };
}

function createCopilotTranscriptionService(...deps: unknown[]) {
  return new CopilotTranscriptionService(
    deps[0] as never,
    deps[1] as never,
    deps[2] as never,
    deps[3] as never,
    deps[4] as never,
    deps[5] as never,
    (deps[6] ?? {
      assertQuotaOrByok: Sinon.stub().resolves(undefined),
    }) as never,
    (deps[7] ?? { publish: Sinon.stub() }) as never
  );
}

test('queryTask hides ready transcript task result until settlement', async t => {
  const payload = TranscriptPayloadSchema.parse({
    infos: [
      {
        url: 'https://example.com/audio-0.m4a',
        mimeType: 'audio/m4a',
        index: 0,
      },
    ],
    normalizedTranscript: '00:00:05 A: Kickoff',
  });
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves({
          id: 'task-1',
          status: 'ready',
          protectedResult: payload,
        }),
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  const result = await service.queryTask('user-1', 'workspace-1', 'task-1');

  t.is(result?.status, AiJobStatus.finished);
  t.deepEqual(result?.infos, payload.infos);
  t.is(result?.transcription, undefined);
});

test('settleTask unlocks ready transcript task result idempotently', async t => {
  const payload = TranscriptPayloadSchema.parse({
    normalizedTranscript: '00:00:05 A: Kickoff',
  });
  const settle = Sinon.stub().resolves({
    id: 'task-1',
    status: 'settled',
    protectedResult: payload,
  });
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves({
          id: 'task-1',
          status: 'ready',
          protectedResult: payload,
        }),
        settle,
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  const result = await service.settleTask('user-1', 'workspace-1', 'task-1');

  t.is(result?.status, AiJobStatus.finished);
  t.is(result?.transcription?.normalizedTranscript, '00:00:05 A: Kickoff');
  Sinon.assert.calledOnceWithExactly(settle, 'task-1');
});

test('settleTask checks copilot quota before unlocking ready task', async t => {
  const payload = TranscriptPayloadSchema.parse({
    normalizedTranscript: '00:00:05 A: Kickoff',
  });
  const settle = Sinon.stub().resolves({
    id: 'task-1',
    status: 'settled',
    protectedResult: payload,
  });
  const assertQuotaOrByok = Sinon.stub().rejects(new Error('quota exceeded'));
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves({
          id: 'task-1',
          status: 'ready',
          protectedResult: payload,
        }),
        settle,
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { assertQuotaOrByok } as never
  );

  await t.throwsAsync(
    () => service.settleTask('user-1', 'workspace-1', 'task-1'),
    { message: /quota exceeded/ }
  );
  Sinon.assert.calledOnceWithMatch(assertQuotaOrByok, {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    featureKind: 'transcript',
  });
  Sinon.assert.notCalled(settle);
});

test('retryTask rejects ready transcript tasks', async t => {
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves({
          id: 'task-1',
          status: 'ready',
          protectedResult: {},
        }),
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  await t.throwsAsync(
    () => service.retryTask('user-1', 'workspace-1', 'task-1'),
    { message: /cannot be retried/ }
  );
});

test('retryTask rejects settled transcript tasks', async t => {
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves({
          id: 'task-1',
          status: 'settled',
          protectedResult: {},
        }),
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  await t.throwsAsync(
    () => service.retryTask('user-1', 'workspace-1', 'task-1'),
    { message: /cannot be retried/ }
  );
});

test('retryTask reuses failed task and queues a new action attempt', async t => {
  const queuedJobs: unknown[] = [];
  const claimRetry = Sinon.stub().resolves(true);
  const payload = TranscriptPayloadSchema.parse({
    normalizedTranscript: '00:00:05 A: Kickoff',
    summaryJson: null,
    providerMeta: { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  });
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves({
          id: 'task-1',
          status: 'failed',
          strategy: 'gemini',
          actionRunId: 'run-failed',
          protectedResult: payload,
        }),
        claimRetry,
      },
    } as never,
    {
      add: Sinon.stub().callsFake(async (name, payload, options) => {
        queuedJobs.push({ name, payload, options });
      }),
    } as never,
    {} as never,
    {
      resolveTranscriptionModel: Sinon.stub().resolves('gemini-3.5-flash-lite'),
    } as never,
    {} as never,
    {} as never
  );

  const result = await service.retryTask('user-1', 'workspace-1', 'task-1');

  t.is(result.status, AiJobStatus.pending);
  t.like(queuedJobs[0] as Record<string, unknown>, {
    name: 'copilot.transcript.task.submit',
  });
  t.like((queuedJobs[0] as { payload: Record<string, unknown> }).payload, {
    taskId: 'task-1',
    retryOf: 'run-failed',
    modelId: 'gemini-3.5-flash-lite',
  });
  const queued = queuedJobs[0] as {
    payload: { generation: string };
    options: { jobId: string; attempts: number };
  };
  t.true(queued.options.jobId.endsWith(queued.payload.generation));
  t.is(queued.options.attempts, 1);
  Sinon.assert.calledOnceWithMatch(
    claimRetry,
    'task-1',
    'user-1',
    'workspace-1',
    'run-failed',
    Sinon.match.string
  );
});

test('retryTask prechecks quota or BYOK before queueing provider work', async t => {
  const add = Sinon.stub().resolves(undefined);
  const claimRetry = Sinon.stub().resolves(true);
  const assertQuotaOrByok = Sinon.stub().rejects(new Error('quota exceeded'));
  const payload = TranscriptPayloadSchema.parse({
    normalizedTranscript: '00:00:05 A: Kickoff',
  });
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves({
          id: 'task-1',
          status: 'failed',
          strategy: 'gemini',
          protectedResult: payload,
        }),
        claimRetry,
      },
    } as never,
    { add } as never,
    {} as never,
    {
      resolveTranscriptionModel: Sinon.stub().resolves('gemini-3.5-flash-lite'),
    } as never,
    {} as never,
    {} as never,
    { assertQuotaOrByok } as never
  );

  await t.throwsAsync(
    () => service.retryTask('user-1', 'workspace-1', 'task-1'),
    { message: /quota exceeded/ }
  );
  Sinon.assert.calledOnceWithMatch(assertQuotaOrByok, {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    featureKind: 'transcript',
  });
  Sinon.assert.notCalled(add);
  Sinon.assert.notCalled(claimRetry);
});

for (const status of ['ready', 'settled']) {
  test(`submitTask allows a new task for the same blob after ${status} task`, async t => {
    const createdTasks: unknown[] = [];
    const queuedJobs: unknown[] = [];
    const service = createCopilotTranscriptionService(
      {
        copilotTranscriptTask: {
          getWithUser: Sinon.stub().resolves({
            id: `task-${status}`,
            status,
          }),
          create: Sinon.stub().callsFake(async input => {
            createdTasks.push(input);
            return { id: 'task-next' };
          }),
        },
      } as never,
      {
        add: Sinon.stub().callsFake(async (name, payload, options) => {
          queuedJobs.push({ name, payload, options });
        }),
      } as never,
      {} as never,
      {
        resolveTranscriptionModel: Sinon.stub().resolves(
          'gemini-3.5-flash-lite'
        ),
      } as never,
      {} as never,
      {} as never
    );

    const result = await service.submitTask(
      'user-1',
      'workspace-1',
      'blob-1',
      []
    );

    t.is(result.id, 'task-next');
    t.is(result.status, AiJobStatus.pending);
    t.like(createdTasks[0] as Record<string, unknown>, {
      blobId: 'blob-1',
      recipeId: 'transcript.audio.gemini',
      strategy: 'gemini',
    });
    const created = createdTasks[0] as {
      dispatchGeneration: string;
      inputSnapshot: unknown;
      protectedResult: unknown;
    };
    t.is(typeof created.dispatchGeneration, 'string');
    t.deepEqual(created.protectedResult, created.inputSnapshot);
    t.like(queuedJobs[0] as Record<string, unknown>, {
      name: 'copilot.transcript.task.submit',
    });
  });
}

test('submitTask prechecks quota or BYOK before persisting uploads', async t => {
  const assertQuotaOrByok = Sinon.stub().rejects(new Error('quota exceeded'));
  const resolveTranscriptionModel = Sinon.stub().resolves(
    'gemini-3.5-flash-lite'
  );
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves(null),
      },
    } as never,
    {} as never,
    {} as never,
    {
      resolveTranscriptionModel,
    } as never,
    {} as never,
    {} as never,
    { assertQuotaOrByok } as never
  );

  await t.throwsAsync(
    () => service.submitTask('user-1', 'workspace-1', 'blob-1', []),
    { message: /quota exceeded/ }
  );
  Sinon.assert.calledOnceWithMatch(assertQuotaOrByok, {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    featureKind: 'transcript',
  });
  Sinon.assert.notCalled(resolveTranscriptionModel);
});

test('submitTask rejects unavailable transcript strategy', async t => {
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves(null),
      },
    } as never,
    {} as never,
    {} as never,
    {
      resolveTranscriptionModel: Sinon.stub().resolves('gemini-3.5-flash-lite'),
    } as never,
    {} as never,
    {} as never
  );

  await t.throwsAsync(
    () =>
      service.submitTask('user-1', 'workspace-1', 'blob-1', [], {
        strategy: 'local-asr',
      }),
    { message: /not available/ }
  );
});

test('submitTask stores transcript uploads with the detected audio mime', async t => {
  const put = Sinon.stub().resolves(
    'https://localmind.test/api/copilot/blob/user-1/workspace-1/blob-1-0'
  );
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        getWithUser: Sinon.stub().resolves(null),
        create: Sinon.stub().resolves({ id: 'task-1' }),
      },
    } as never,
    { add: Sinon.stub().resolves(undefined) } as never,
    { put } as never,
    {
      resolveTranscriptionModel: Sinon.stub().resolves('gemini-3.5-flash-lite'),
    } as never,
    {} as never,
    {} as never
  );
  const buffer = Buffer.concat([
    Buffer.from('OggS'),
    Buffer.alloc(24),
    Buffer.from('OpusHead'),
  ]);

  await service.submitTask('user-1', 'workspace-1', 'blob-1', [
    {
      filename: 'recording.opus',
      mimetype: 'audio/opus',
      encoding: '7bit',
      createReadStream: () => Readable.from(buffer),
    },
  ]);

  t.true(
    put.calledOnceWithExactly(
      'user-1',
      'workspace-1',
      'blob-1-0',
      buffer,
      'audio/opus'
    )
  );
});

test('transcriptTask runs native transcript recipe through action bridge when available', async t => {
  const fallbackUrl =
    'https://localmind.test/api/copilot/blob/user-1/workspace-1/blob-1-2';
  const payload = TranscriptPayloadSchema.parse({
    sourceAudio: { blobId: 'blob-1', mimeType: 'audio/opus' },
    sliceManifest: [
      {
        index: 0,
        fileName: 'audio-0.opus',
        mimeType: 'audio/opus',
        startSec: 12,
        durationSec: 30,
      },
    ],
    infos: [
      {
        url: 'data:image/png;base64,YXVkaW8=',
        mimeType: 'audio/opus',
        index: 0,
      },
      {
        key: 'blob-1-1',
        url: 'https://localmind.test/api/copilot/blob/user-1/workspace-1/blob-1-1',
        mimeType: 'audio/opus',
        index: 1,
      },
      {
        key: 'blob-1-2',
        url: fallbackUrl,
        mimeType: 'audio/opus',
        index: 2,
      },
    ],
  });
  const bridgeInputs: unknown[] = [];
  const attachActionRun = Sinon.stub().resolves(true);
  const completeDispatch = Sinon.stub().resolves(true);
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        get: Sinon.stub().resolves({
          id: 'task-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          blobId: 'blob-1',
          status: 'pending',
          actionRunId: null,
        }),
        claimDispatch: Sinon.stub().resolves(true),
        attachActionRun,
        completeDispatch,
      },
    } as never,
    {} as never,
    {
      presignGet: Sinon.stub().callsFake(async (_userId, _workspaceId, key) =>
        key === 'blob-1-1' ? 'https://storage.test/signed-audio' : undefined
      ),
      keyFromUrl: Sinon.stub(),
    } as never,
    {} as never,
    createTranscriptPromptService() as never,
    createSuccessfulTranscriptBridge('run-bridge', bridgeInputs) as never
  );

  await service.transcriptTask({
    taskId: 'task-1',
    payload,
    generation: 'generation-1',
    modelId: 'gemini-3.5-flash-lite',
  });

  t.like(bridgeInputs[0] as Record<string, unknown>, {
    actionId: 'transcript.audio.gemini',
    actionVersion: 'v1',
  });
  t.like(
    (bridgeInputs[0] as { prepareStructuredRoutes: Record<string, unknown> })
      .prepareStructuredRoutes,
    {
      stepId: 'transcribe',
      modelId: 'gemini-3.5-flash-lite',
    }
  );
  const messages = (
    bridgeInputs[0] as {
      prepareStructuredRoutes: {
        messages: { content?: string; attachments?: unknown[] }[];
      };
    }
  ).prepareStructuredRoutes.messages;
  t.false(messages[0].content?.includes('data:image/png'));
  t.deepEqual(JSON.parse(messages[0].content ?? '{}').infos, [
    { mimeType: 'audio/opus', index: 0 },
    { mimeType: 'audio/opus', index: 1 },
    { mimeType: 'audio/opus', index: 2 },
  ]);
  t.deepEqual(messages[1]?.attachments, [
    { attachment: 'data:image/png;base64,YXVkaW8=', mimeType: 'audio/opus' },
  ]);
  t.deepEqual(messages[2]?.attachments, [
    { attachment: 'https://storage.test/signed-audio', mimeType: 'audio/opus' },
  ]);
  t.deepEqual(messages.at(-1)?.attachments, [
    { attachment: fallbackUrl, mimeType: 'audio/opus' },
  ]);
  t.deepEqual(
    (
      bridgeInputs[0] as {
        nativeInput: { input: { infos: unknown[] } };
      }
    ).nativeInput.input.infos,
    [
      {
        url: 'data:image/png;base64,YXVkaW8=',
        mimeType: 'audio/opus',
        index: 0,
      },
      {
        url: 'https://storage.test/signed-audio',
        mimeType: 'audio/opus',
        index: 1,
      },
      {
        url: fallbackUrl,
        mimeType: 'audio/opus',
        index: 2,
      },
    ]
  );
  t.like(completeDispatch.firstCall.args[3], {
    status: 'ready',
    errorCode: null,
  });
  Sinon.assert.calledOnceWithExactly(
    attachActionRun,
    'task-1',
    'generation-1',
    null,
    'run-bridge'
  );
  t.is(
    completeDispatch.firstCall.args[3].protectedResult.normalizedTranscript,
    '00:00:05 A: Kickoff'
  );
  t.deepEqual(
    completeDispatch.firstCall.args[3].protectedResult.infos,
    payload.infos
  );
});

test('transcriptTask retries transient provider failures with a new action run', async t => {
  const clock = Sinon.useFakeTimers();
  t.teardown(() => clock.restore());
  const payload = TranscriptPayloadSchema.parse({
    sourceAudio: { blobId: 'blob-1', durationMs: 30_000 },
    infos: [
      {
        url: 'data:audio/opus;base64,YXVkaW8=',
        mimeType: 'audio/opus',
        index: 0,
      },
    ],
  });
  const bridgeInputs: any[] = [];
  let attempt = 0;
  const completeDispatch = Sinon.stub().resolves(true);
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        get: Sinon.stub().resolves({
          id: 'task-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          status: 'pending',
          actionRunId: null,
        }),
        claimDispatch: Sinon.stub().resolves(true),
        attachActionRun: Sinon.stub().resolves(true),
        completeDispatch,
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    createTranscriptPromptService() as never,
    {
      runStream: (input: any) =>
        (async function* () {
          attempt += 1;
          const runId = `run-${attempt}`;
          const { result } = await buildNativeTranscriptResult(input, runId);
          bridgeInputs.push(input);
          if (attempt === 1) {
            yield {
              type: 'error' as const,
              actionId: 'transcript.audio.gemini',
              actionVersion: 'v1',
              status: 'failed' as const,
              runId,
              errorMessage: 'upstream returned status 503: UNAVAILABLE',
            };
            return;
          }
          yield {
            type: 'action_done' as const,
            actionId: 'transcript.audio.gemini',
            actionVersion: 'v1',
            status: 'succeeded' as const,
            runId,
            result,
          };
        })(),
    } as never
  );

  const run = service.transcriptTask({
    taskId: 'task-1',
    payload,
    generation: 'generation-1',
    modelId: 'gemini-3.5-flash-lite',
  });
  await clock.tickAsync(5_000);
  await run;

  t.is(bridgeInputs.length, 2);
  t.is(bridgeInputs[0].retryOf, null);
  t.is(bridgeInputs[1].retryOf, 'run-1');
  Sinon.assert.calledWith(completeDispatch, 'task-1', 'generation-1', 'run-2');
});

test('transcriptTask fails task when native action bridge reports an error event', async t => {
  const payload = TranscriptPayloadSchema.parse({
    normalizedTranscript: '00:00:05 A: Kickoff',
  });
  const completeDispatch = Sinon.stub().resolves(true);
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        get: Sinon.stub().resolves({
          id: 'task-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          blobId: 'blob-1',
          status: 'pending',
          actionRunId: null,
        }),
        claimDispatch: Sinon.stub().resolves(true),
        attachActionRun: Sinon.stub().resolves(true),
        completeDispatch,
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    createTranscriptPromptService() as never,
    {
      runStream: (input: unknown) =>
        (async function* () {
          await buildNativeTranscriptResult(input, 'run-bridge');
          yield {
            type: 'error' as const,
            actionId: 'transcript.audio.gemini',
            actionVersion: 'v1',
            status: 'failed' as const,
            runId: 'run-bridge',
            errorCode: 'native_failed',
          };
        })(),
    } as never
  );

  await t.throwsAsync(
    () =>
      service.transcriptTask({
        taskId: 'task-1',
        payload,
        generation: 'generation-1',
        modelId: 'gemini-3.5-flash-lite',
      }),
    { message: /native_failed/ }
  );
  t.like(completeDispatch.firstCall.args[3], {
    status: 'failed',
  });
});

test('transcriptTask ignores duplicate dispatches before provider work', async t => {
  const runStream = Sinon.stub();
  const completeDispatch = Sinon.stub();
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        get: Sinon.stub().resolves({
          id: 'task-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          status: 'running',
        }),
        claimDispatch: Sinon.stub().resolves(false),
        completeDispatch,
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { runStream } as never
  );

  await service.transcriptTask({
    taskId: 'task-1',
    payload: TranscriptPayloadSchema.parse({
      normalizedTranscript: '00:00:05 A: Kickoff',
    }),
    generation: 'generation-duplicate',
  });

  t.false(runStream.called);
  t.false(completeDispatch.called);
  Sinon.assert.notCalled(runStream);
  Sinon.assert.notCalled(completeDispatch);
});

test('reconcileDispatches requeues pending work and expires stale running work', async t => {
  const add = Sinon.stub().resolves(undefined);
  const failRunningDispatch = Sinon.stub().resolves(true);
  const publish = Sinon.stub();
  const payload = TranscriptPayloadSchema.parse({
    normalizedTranscript: '00:00:05 A: Kickoff',
  });
  const service = createCopilotTranscriptionService(
    {
      copilotTranscriptTask: {
        pendingDispatches: Sinon.stub().resolves([
          {
            id: 'task-pending',
            userId: 'user-1',
            workspaceId: 'workspace-1',
            strategy: 'gemini',
            actionRunId: null,
            dispatchGeneration: 'generation-pending',
            protectedResult: payload,
          },
        ]),
        staleRunningDispatches: Sinon.stub().resolves([
          {
            id: 'task-running',
            workspaceId: 'workspace-1',
            dispatchGeneration: 'generation-running',
          },
        ]),
        failRunningDispatch,
      },
    } as never,
    { add } as never,
    {} as never,
    {
      resolveTranscriptionModel: Sinon.stub().resolves('gemini-3.5-flash-lite'),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    { publish } as never
  );

  await service.reconcileDispatches();

  t.true(add.calledOnce);
  t.true(failRunningDispatch.calledOnce);
  t.true(publish.called);
  Sinon.assert.calledOnceWithMatch(
    add,
    'copilot.transcript.task.submit',
    {
      taskId: 'task-pending',
      generation: 'generation-pending',
      modelId: 'gemini-3.5-flash-lite',
    },
    {
      jobId: 'copilot-transcript-task/task-pending/generation-pending',
      attempts: 1,
    }
  );
  Sinon.assert.calledOnceWithExactly(
    failRunningDispatch,
    'task-running',
    'generation-running',
    'transcript_dispatch_timed_out'
  );
  Sinon.assert.calledWithMatch(
    publish,
    'copilot.transcript.task.changed',
    { workspaceId: 'workspace-1', taskId: 'task-running' },
    { status: AiJobStatus.failed }
  );
});
