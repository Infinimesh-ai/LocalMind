import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiJobStatus } from '@prisma/client';

import {
  CopilotTranscriptionJobExists,
  CopilotTranscriptionJobNotFound,
  type FileUpload,
  JobQueue,
  OneHour,
  OneMinute,
  OnJob,
  sniffMime,
} from '../../../base';
import {
  RealtimePublisher,
  realtimeTranscriptTaskRoom,
} from '../../../core/realtime';
import { Models } from '../../../models';
import { CopilotAccessPolicy } from '../access';
import { PromptService } from '../prompt';
import { CopilotProviderType } from '../providers/types';
import { ActionRuntimeBridge } from '../runtime/action-runtime-bridge';
import { TaskPolicy } from '../runtime/task-policy';
import { CopilotStorage } from '../storage';
import { taskToJob, type TranscriptionJob } from './job';
import { normalizeTranscriptResultTimestamps } from './projection';
import {
  TranscriptActionResultContract,
  TranscriptPayloadSchema,
} from './schema';
import type {
  AudioBlobInfos,
  TranscriptionPayloadV2,
  TranscriptionSubmitInput,
} from './types';
import { readStream } from './utils';

const TRANSCRIPT_ACTION_ID = 'transcript.audio.gemini';
const TRANSCRIPT_ACTION_VERSION = 'v1';
const TRANSCRIPT_STRATEGY = 'gemini';
const TRANSCRIPT_RETRY_DELAYS = [5_000, 15_000];

function isRetryableTranscriptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /upstream returned status (?:429|5\d\d)|RESOURCE_EXHAUSTED|UNAVAILABLE|llm_timeout|timed? out|fetch failed/i.test(
    message
  );
}

@Injectable()
export class CopilotTranscriptionService {
  private readonly logger = new Logger(CopilotTranscriptionService.name);

  constructor(
    private readonly models: Models,
    private readonly job: JobQueue,
    private readonly storage: CopilotStorage,
    private readonly tasks: TaskPolicy,
    private readonly prompts: PromptService,
    private readonly actionBridge: ActionRuntimeBridge,
    private readonly access: CopilotAccessPolicy,
    private readonly realtime: RealtimePublisher
  ) {}

  private parseTaskPayload(payload: unknown): TranscriptionPayloadV2 {
    return TranscriptPayloadSchema.parse(payload);
  }

  private buildTaskPublicMeta(payload: TranscriptionPayloadV2) {
    return {
      sourceAudio: payload.sourceAudio,
      quality: payload.quality,
      sliceManifest: payload.sliceManifest,
      providerMeta: payload.providerMeta,
      version: 'transcript-result-v1',
      strategy: TRANSCRIPT_STRATEGY,
    };
  }

  private async resolveTranscriptStrategy(userId: string, strategy?: string) {
    if (strategy && strategy !== TRANSCRIPT_STRATEGY) {
      throw new BadRequestException(
        `Transcript strategy ${strategy} is not available`
      );
    }
    const model = await this.tasks.resolveTranscriptionModel(userId);
    if (!model) {
      throw new BadRequestException(
        'Transcript strategy gemini is not available'
      );
    }
    return { model, strategy: TRANSCRIPT_STRATEGY };
  }

  private async persistUploads(
    userId: string,
    workspaceId: string,
    blobId: string,
    blobs: FileUpload[]
  ) {
    const infos: AudioBlobInfos = [];
    for (const [idx, blob] of blobs.entries()) {
      const buffer = await readStream(blob.createReadStream());
      const key = `${blobId}-${idx}`;
      const mimeType = sniffMime(buffer, blob.mimetype) || blob.mimetype;
      const url = await this.storage.put(
        userId,
        workspaceId,
        key,
        buffer,
        mimeType
      );
      infos.push({
        key,
        url,
        mimeType,
        index: idx,
      });
    }
    return infos;
  }

  private createCanonicalPayload(
    blobId: string,
    infos: AudioBlobInfos,
    input?: TranscriptionSubmitInput
  ) {
    const sliceManifest = input?.sliceManifest?.length
      ? input.sliceManifest.map(item => ({
          ...item,
          byteSize: item.byteSize ?? null,
        }))
      : undefined;

    return {
      infos,
      sourceAudio: { blobId, ...input?.sourceAudio },
      quality: input?.quality,
      sliceManifest,
    } satisfies TranscriptionPayloadV2;
  }

  private async resolveAttachmentUrl(
    userId: string,
    workspaceId: string,
    info: AudioBlobInfos[number]
  ) {
    if (info.url.startsWith('data:')) {
      return info.url;
    }

    const key =
      info.key ?? this.storage.keyFromUrl(userId, workspaceId, info.url);
    if (!key) {
      throw new Error('Transcript attachment cannot be resolved');
    }

    const signedUrl = await this.storage.presignGet(userId, workspaceId, key);
    return signedUrl ?? info.url;
  }

  private async materializePayload(
    userId: string,
    workspaceId: string,
    payload: TranscriptionPayloadV2
  ) {
    return {
      ...payload,
      infos: payload.infos
        ? await Promise.all(
            payload.infos.map(async info => ({
              url: await this.resolveAttachmentUrl(userId, workspaceId, info),
              mimeType: info.mimeType,
              index: info.index,
            }))
          )
        : payload.infos,
    } satisfies TranscriptionPayloadV2;
  }

  private async buildTranscriptActionMessages(
    payload: TranscriptionPayloadV2,
    modelId?: string
  ) {
    const prompt = await this.prompts.get('Transcript audio structured');
    if (!prompt) {
      throw new Error('Transcript action prompt not found');
    }
    const metadata = {
      sourceAudio: payload.sourceAudio ?? null,
      quality: payload.quality ?? null,
      sliceManifest: payload.sliceManifest ?? null,
      infos:
        payload.infos?.map(info => ({
          mimeType: info.mimeType,
          index: info.index ?? null,
        })) ?? null,
      providerMeta: {
        provider: CopilotProviderType.Gemini,
        model: modelId ?? payload.providerMeta?.model ?? null,
      },
    };
    const attachments =
      payload.infos?.map(info => ({
        role: 'user' as const,
        content: `Audio attachment ${info.index ?? 0}`,
        attachments: [{ attachment: info.url, mimeType: info.mimeType }],
        params: { mimetype: info.mimeType },
      })) ?? [];
    return [
      ...this.prompts.finish(prompt, {
        content: JSON.stringify(metadata),
      }),
      ...attachments,
    ];
  }

  private async enqueuePendingTask(
    taskId: string,
    payload: TranscriptionPayloadV2,
    generation: string,
    modelId: string,
    retryOf: string | null,
    rollbackOnError = true
  ) {
    try {
      await this.job.add(
        'copilot.transcript.task.submit',
        {
          taskId,
          payload,
          generation,
          modelId,
          retryOf: retryOf ?? undefined,
        },
        {
          jobId: `copilot-transcript-task/${taskId}/${generation}`,
          attempts: 1,
          removeOnFail: true,
        }
      );
    } catch (error) {
      if (rollbackOnError) {
        await this.models.copilotTranscriptTask.failPendingDispatch(
          taskId,
          generation,
          error instanceof Error ? error.message : 'transcript_enqueue_failed'
        );
      }
      throw error;
    }
  }

  async submitTask(
    userId: string,
    workspaceId: string,
    blobId: string,
    blobs: FileUpload[],
    input?: TranscriptionSubmitInput & { strategy?: string | null }
  ): Promise<TranscriptionJob> {
    const existingTask = await this.models.copilotTranscriptTask.getWithUser(
      userId,
      workspaceId,
      undefined,
      blobId
    );
    if (
      existingTask &&
      (existingTask.status === 'pending' || existingTask.status === 'running')
    ) {
      throw new CopilotTranscriptionJobExists();
    }

    await this.access.assertQuotaOrByok({
      userId,
      workspaceId,
      featureKind: 'transcript',
    });

    const { model, strategy } = await this.resolveTranscriptStrategy(
      userId,
      input?.strategy ?? undefined
    );
    const infos = await this.persistUploads(userId, workspaceId, blobId, blobs);
    const payload = this.createCanonicalPayload(blobId, infos, input);
    const generation = randomUUID();
    const task = await this.models.copilotTranscriptTask.create({
      userId,
      workspaceId,
      blobId,
      strategy,
      recipeId: TRANSCRIPT_ACTION_ID,
      recipeVersion: TRANSCRIPT_ACTION_VERSION,
      dispatchGeneration: generation,
      inputSnapshot: payload,
      publicMeta: this.buildTaskPublicMeta(payload),
      protectedResult: payload,
    });

    await this.enqueuePendingTask(task.id, payload, generation, model, null);
    this.publishTaskChanged(workspaceId, task.id, AiJobStatus.pending);

    return { id: task.id, status: AiJobStatus.pending, infos };
  }

  async retryTask(userId: string, workspaceId: string, taskId: string) {
    const task = await this.models.copilotTranscriptTask.getWithUser(
      userId,
      workspaceId,
      taskId
    );
    if (!task) {
      throw new CopilotTranscriptionJobNotFound();
    }
    if (task.status === 'ready' || task.status === 'settled') {
      throw new BadRequestException(
        'Ready or settled transcript tasks cannot be retried'
      );
    }
    if (task.status !== 'failed') {
      throw new BadRequestException(
        'Only failed transcript tasks can be retried'
      );
    }

    await this.access.assertQuotaOrByok({
      userId,
      workspaceId,
      featureKind: 'transcript',
    });

    const payload = this.parseTaskPayload(task.protectedResult);
    const { model } = await this.resolveTranscriptStrategy(
      userId,
      task.strategy
    );
    const generation = randomUUID();
    const retryOf = task.actionRunId ?? null;
    const claimed = await this.models.copilotTranscriptTask.claimRetry(
      taskId,
      userId,
      workspaceId,
      retryOf,
      generation
    );
    if (!claimed) {
      throw new BadRequestException(
        'Only failed transcript tasks can be retried'
      );
    }
    await this.enqueuePendingTask(taskId, payload, generation, model, retryOf);
    this.publishTaskChanged(workspaceId, taskId, AiJobStatus.pending);
    return {
      id: taskId,
      status: AiJobStatus.pending,
      infos: payload.infos ?? undefined,
    };
  }

  async settleTask(userId: string, workspaceId: string, taskId: string) {
    const task = await this.models.copilotTranscriptTask.getWithUser(
      userId,
      workspaceId,
      taskId
    );
    if (!task) {
      throw new CopilotTranscriptionJobNotFound();
    }
    if (task.status === 'failed') {
      throw new BadRequestException(
        'Failed transcript tasks cannot be settled'
      );
    }
    if (task.status !== 'ready' && task.status !== 'settled') {
      return null;
    }

    if (task.status === 'settled') {
      return taskToJob(task);
    }

    await this.access.assertQuotaOrByok({
      userId,
      workspaceId,
      featureKind: 'transcript',
    });

    const settled = await this.models.copilotTranscriptTask.settle(task.id);
    return taskToJob(settled);
  }

  async queryTask(
    userId: string,
    workspaceId: string,
    taskId?: string,
    blobId?: string
  ) {
    const task = await this.models.copilotTranscriptTask.getWithUser(
      userId,
      workspaceId,
      taskId,
      blobId
    );
    return taskToJob(task);
  }

  @OnJob('copilot.transcript.task.submit')
  async transcriptTask({
    taskId,
    payload,
    generation: queuedGeneration,
    modelId,
    retryOf,
  }: Jobs['copilot.transcript.task.submit']) {
    const task = await this.models.copilotTranscriptTask.get(taskId);
    if (!task) {
      throw new CopilotTranscriptionJobNotFound();
    }

    let actionRunId = retryOf ?? null;
    const generation = queuedGeneration ?? randomUUID();
    if (
      !queuedGeneration &&
      !(await this.models.copilotTranscriptTask.adoptLegacyDispatch(
        taskId,
        actionRunId,
        generation
      ))
    ) {
      return;
    }
    const claimed = await this.models.copilotTranscriptTask.claimDispatch(
      taskId,
      generation,
      actionRunId
    );
    if (!claimed) {
      return;
    }

    try {
      let finalResult: unknown = null;
      for (let attempt = 0; ; attempt++) {
        try {
          let bridgeFailed = false;
          let bridgeError = 'transcript native recipe failed';
          const runtimePayload = await this.materializePayload(
            task.userId,
            task.workspaceId,
            payload
          );
          const messages = await this.buildTranscriptActionMessages(
            runtimePayload,
            modelId
          );
          for await (const event of this.actionBridge.runStream({
            userId: task.userId,
            workspaceId: task.workspaceId,
            actionId: TRANSCRIPT_ACTION_ID,
            actionVersion: TRANSCRIPT_ACTION_VERSION,
            retryOf: actionRunId,
            inputSnapshot: runtimePayload,
            nativeInput: {
              input: {
                sourceAudio: runtimePayload.sourceAudio ?? null,
                quality: runtimePayload.quality ?? null,
                infos: runtimePayload.infos ?? null,
                sliceManifest: runtimePayload.sliceManifest ?? null,
              },
            },
            onRunCreated: async ({ runId }) => {
              const attached =
                await this.models.copilotTranscriptTask.attachActionRun(
                  taskId,
                  generation,
                  actionRunId,
                  runId
                );
              if (!attached) {
                throw new Error('stale transcript dispatch generation');
              }
              actionRunId = runId;
              this.publishTaskChanged(
                task.workspaceId,
                taskId,
                AiJobStatus.running
              );
            },
            prepareStructuredRoutes: {
              stepId: 'transcribe',
              modelId,
              messages,
              options: {
                user: task.userId,
                workspace: task.workspaceId,
                taskId,
                billingUnitId: taskId,
                featureKind: 'transcript',
              },
              prefer: CopilotProviderType.Gemini,
              responseContract: TranscriptActionResultContract,
            },
          })) {
            actionRunId = event.runId;
            if (event.type === 'error' || event.status === 'failed') {
              bridgeFailed = true;
              bridgeError =
                event.errorMessage ?? event.errorCode ?? bridgeError;
            }
            if (event.type === 'action_done' && event.status === 'succeeded') {
              finalResult = event.result;
            }
          }
          if (bridgeFailed) {
            throw new Error(bridgeError);
          }
          break;
        } catch (error) {
          const retryDelay = TRANSCRIPT_RETRY_DELAYS[attempt];
          if (retryDelay === undefined || !isRetryableTranscriptError(error)) {
            throw error;
          }
          this.logger.warn(
            `Retrying transcript task ${taskId} after transient failure`,
            error
          );
          await setTimeout(retryDelay);
        }
      }
      const result = TranscriptPayloadSchema.parse(finalResult);
      const parsedResult = normalizeTranscriptResultTimestamps({
        ...result,
        sourceAudio: result.sourceAudio ?? payload.sourceAudio,
        quality: result.quality ?? payload.quality,
        sliceManifest: result.sliceManifest ?? payload.sliceManifest,
        infos: payload.infos,
        providerMeta: result.providerMeta ?? payload.providerMeta,
        strategy: result.strategy ?? payload.strategy,
      } satisfies TranscriptionPayloadV2);
      const completed =
        await this.models.copilotTranscriptTask.completeDispatch(
          taskId,
          generation,
          actionRunId,
          {
            status: 'ready',
            publicMeta: this.buildTaskPublicMeta(parsedResult),
            protectedResult: parsedResult,
            errorCode: null,
          }
        );
      if (completed) {
        this.publishTaskChanged(task.workspaceId, taskId, AiJobStatus.finished);
      }
    } catch (error) {
      const errorCode =
        error instanceof Error ? error.message : 'transcript_task_failed';
      const failed = await this.models.copilotTranscriptTask.completeDispatch(
        taskId,
        generation,
        actionRunId,
        {
          status: 'failed',
          publicMeta: this.buildTaskPublicMeta(payload),
          protectedResult: payload,
          errorCode,
        }
      );
      if (failed) {
        this.publishTaskChanged(
          task.workspaceId,
          taskId,
          AiJobStatus.failed,
          errorCode
        );
      }
      throw error;
    }
  }

  async reconcileDispatches() {
    const pending = await this.models.copilotTranscriptTask.pendingDispatches(
      new Date(Date.now() - OneMinute)
    );
    for (const task of pending) {
      const generation = task.dispatchGeneration;
      if (!generation) continue;
      const parsed = TranscriptPayloadSchema.safeParse(
        task.protectedResult ?? task.inputSnapshot
      );
      if (!parsed.success) {
        await this.models.copilotTranscriptTask.failPendingDispatch(
          task.id,
          generation,
          'invalid_transcript_dispatch_payload'
        );
        continue;
      }
      try {
        const { model } = await this.resolveTranscriptStrategy(
          task.userId,
          task.strategy
        );
        await this.enqueuePendingTask(
          task.id,
          parsed.data,
          generation,
          model,
          task.actionRunId,
          false
        );
      } catch (error) {
        this.logger.warn(
          `Failed to recover pending transcript task ${task.id}`,
          error
        );
      }
    }

    const running =
      await this.models.copilotTranscriptTask.staleRunningDispatches(
        new Date(Date.now() - OneHour * 6)
      );
    for (const task of running) {
      const generation = task.dispatchGeneration;
      if (!generation) continue;
      const failed =
        await this.models.copilotTranscriptTask.failRunningDispatch(
          task.id,
          generation,
          'transcript_dispatch_timed_out'
        );
      if (failed) {
        this.publishTaskChanged(
          task.workspaceId,
          task.id,
          AiJobStatus.failed,
          'transcript_dispatch_timed_out'
        );
      }
    }
  }

  private publishTaskChanged(
    workspaceId: string,
    taskId: string,
    status: AiJobStatus,
    error?: string
  ) {
    this.realtime.publish(
      'copilot.transcript.task.changed',
      { workspaceId, taskId },
      { taskId, status, error },
      { room: realtimeTranscriptTaskRoom(workspaceId, taskId) }
    );
  }
}
