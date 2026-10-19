import './report-config';

import {
  layoutReport,
  mergeReportCandidate,
  normalizeReportResponsibility,
  projectReportAudience,
  type ReportDocument,
  ReportDocumentSchema,
  ReportSelectionSchema,
} from '@localmind/office/report';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { BadRequest, Config, JobQueue, ResourceConflict } from '../../base';
import { ProjectBlobStorage } from '../../core/project';
import { ProjectReportSourceService } from '../../core/project-report/source-service';
import { Models } from '../../models';
import type {
  ProjectAgentLease,
  ProjectAgentRun,
} from '../../models/copilot-project-agent-runtime';
import type {
  ReportActor,
  ReportLeaseProof,
} from '../../models/project-report';
import {
  PROJECT_REPORT_WORKFLOW,
  REPORT_PHASES,
  ReportCaptureSchema,
  ReportCheckpointSchema,
  ReportCompositionSchema,
  ReportExtractionSchema,
  type ReportGenerationCommand,
  ReportGenerationCommandSchema,
  type ReportTextSnapshot,
  ReportTextSnapshotSchema,
} from '../../models/project-report-generation-contract';
import { ReportGenerationError } from '../../models/project-report-generation-error';
import { projectResourceHash } from '../../models/project-resource';
import { isInvalidStructuredOutputError } from '../../native';
import { CopilotAgentRuntimeWorkflowRegistry } from './agent-runtime-workflow-registry';
import { ByokService } from './byok';
import { compareReportEvidence } from './report-comparison';
import {
  assertReportEvidenceUnchanged,
  type GroundedReportFact,
  groundReportFacts,
  makeReportEvidenceDocument,
  REPORT_COMPOSITION_PROMPT,
  REPORT_EXTRACTION_PROMPT,
  REPORT_PROMPTS,
  REPORT_RECONCILIATION_PROMPT,
  REPORT_REWRITE_PROMPT,
  reportFactNode,
  reportStableId,
} from './report-generation-policy';
import { ensurePromptResponseSchemaHash } from './runtime/contracts/structured-output-contract';
import { PromptRuntime } from './runtime/prompt-runtime';

const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const factSchema = ReportExtractionSchema.shape.facts.element.extend({
  id: z.string(),
  changedInPeriod: z.boolean(),
});
const factsSchema = z.object({
  facts: z.array(factSchema).max(10000),
  rejected: z.number(),
  budgetExceeded: z.boolean(),
});
const conflictSchema = z
  .object({
    conflicts: z
      .array(
        z
          .object({
            factIds: z.array(z.string()).min(2).max(20),
            message: z.string().max(4000),
          })
          .strict()
      )
      .max(200),
  })
  .strict();
const reconciliationSchema = conflictSchema.extend({
  complete: z.boolean(),
  budgetExceeded: z.boolean(),
});
const rewriteSchema = z
  .object({
    items: z
      .array(
        z.object({ nodeId: z.string(), text: z.string().max(16000) }).strict()
      )
      .max(2000),
  })
  .strict();
const resultSchema = z.object({
  candidateRevisionId: z.string(),
  sourceManifestId: z.string(),
});

export type ProjectReportGenerationInput = ReportActor & {
  expectedVersion: number;
  requestKey: string;
  operation?: 'create' | 'refresh' | 'rewrite';
  scope?: ReportGenerationCommand['scope'];
  instruction?: string;
  cutoffAt?: string;
  selection?: ReportGenerationCommand['selection'];
};

@Injectable()
export class ProjectReportGenerationService {
  constructor(
    private readonly models: Models,
    private readonly blobs: ProjectBlobStorage,
    private readonly sources: ProjectReportSourceService,
    private readonly prompts: PromptRuntime,
    private readonly byok: ByokService,
    private readonly config: Config,
    private readonly queue: JobQueue,
    registry: CopilotAgentRuntimeWorkflowRegistry
  ) {
    registry.registerProject({
      workflow: PROJECT_REPORT_WORKFLOW,
      preparationTimeoutMs: 3600000,
      capabilities: {
        version: 'agent-runtime-workflow-adapter-capabilities/v1',
        supportedStepTypes: ['tool', 'model'],
        sideEffectMode: 'project_write',
        summary:
          'Generate document-grounded Project report candidates with immutable source checkpoints and explicit application.',
      },
      prepare: run => this.prepare(run),
      execute: async () => {
        throw new BadRequest(
          'Report generation requires its persisted preparation checkpoints'
        );
      },
    });
  }

  async request(input: ProjectReportGenerationInput) {
    const report = await this.models.projectReport.get(input);
    const previous = await this.models.copilotProjectAgentRuntime.findRequest({
      ...input,
      sourceType: 'project_report',
      requestKey: `generate:${input.actorId}:${input.requestKey}`,
    });
    const original = previous
      ? ReportGenerationCommandSchema.parse(
          previous.steps.find(step => step.stepKey === 'execute')?.input
        )
      : undefined;
    const baseline =
      original?.baselineRevisionId ??
      report.draftRevisionId ??
      report.latestFinalRevisionId;
    if (!baseline) throw new BadRequest('Report needs a baseline revision');
    const command = ReportGenerationCommandSchema.parse({
      version: 1,
      reportId: input.reportId,
      baselineRevisionId: baseline,
      expectedVersion: input.expectedVersion,
      operation: input.operation ?? 'create',
      selection: ReportSelectionSchema.parse(
        input.selection ?? report.selection
      ),
      instruction: input.instruction ?? '',
      scope: input.scope ?? {},
      cutoffAt:
        input.cutoffAt ?? original?.cutoffAt ?? new Date().toISOString(),
    });
    if (
      command.operation === 'rewrite' &&
      !command.scope.chapterIds?.length &&
      !command.scope.nodeIds?.length
    )
      throw new BadRequest('Select report content before rewriting');
    const run = await this.models.projectReportGeneration.request({
      ...input,
      command,
      explicitCutoff: input.cutoffAt !== undefined,
    });
    await this.queue.add(
      'copilot.projectAgentRuntime.run',
      { projectId: input.projectId, runId: run.id },
      { jobId: `report-${run.id}-${run.workerAttempt}` }
    );
    return { reportId: input.reportId, runId: run.id, status: run.status };
  }

  async getTask(input: ReportActor & { runId?: string }) {
    const task = await this.models.projectReportGeneration.run(input);
    if (!task) return null;
    const persisted = resultSchema.safeParse(
      task.steps.find(step => step.stepKey === 'persist')?.outputSummary
    );
    return {
      reportId: input.reportId,
      runId: task.id,
      status: task.status,
      actorId: task.actorId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      failureCode: task.failureCode,
      phases: REPORT_PHASES.map(key => {
        const step = task.steps.find(step => step.stepKey === key);
        return {
          key,
          status: step?.status ?? 'pending',
          startedAt: step?.startedAt ?? null,
          completedAt: step?.completedAt ?? null,
        };
      }),
      modelCalls: task.steps.filter(step =>
        step.stepKey.startsWith('model-call:')
      ).length,
      ...(persisted.success ? persisted.data : {}),
    };
  }

  async cancel(input: ReportActor & { runId: string }) {
    const task = await this.models.projectReportGeneration.run(input);
    if (!task) throw new BadRequest('Report task is unavailable');
    await this.models.copilotProjectAgentRuntime.cancel(input);
    return this.getTask(input);
  }

  async retry(input: ReportActor & { runId: string }) {
    const task = await this.models.projectReportGeneration.retry(input);
    if (!task) throw new BadRequest('Report task is unavailable');
    await this.queue.add(
      'copilot.projectAgentRuntime.run',
      { projectId: input.projectId, runId: task.id },
      { jobId: `report-${task.id}-${task.workerAttempt}` }
    );
    return this.getTask(input);
  }

  async candidate(
    input: ReportActor & {
      runId: string;
      choices?: Record<string, 'current' | 'candidate'>;
    }
  ) {
    const task = await this.models.projectReportGeneration.run(input);
    const output = resultSchema.safeParse(
      task?.steps.find(step => step.stepKey === 'persist')?.outputSummary
    );
    if (!task || task.status !== 'completed' || !output.success)
      throw new BadRequest('Report candidate is not ready');
    const base = await this.readDocument({
      ...input,
      revisionId: task.command.baselineRevisionId,
    });
    const current = await this.readDocument(input);
    const candidate = await this.readDocument({
      ...input,
      revisionId: output.data.candidateRevisionId,
    });
    const merged = mergeReportCandidate(base, current, candidate, {
      ...task.command.scope,
      resolutions: input.choices,
      evidence: { coverage: candidate.coverage, cutoffAt: candidate.cutoffAt },
    });
    return {
      ...output.data,
      baseRevisionId: task.command.baselineRevisionId,
      selection: task.command.selection,
      base,
      current,
      candidate,
      ...merged,
    };
  }

  async apply(
    input: ReportActor & {
      runId: string;
      expectedVersion: number;
      requestKey: string;
      editLease: ReportLeaseProof;
      choices?: Record<string, 'current' | 'candidate'>;
    }
  ) {
    const candidate = await this.candidate(input);
    if (candidate.conflicts.length)
      throw new ResourceConflict(
        'Resolve report merge conflicts before applying'
      );
    const document = candidate.document;
    await this.sources.validateSources({ ...input, document });
    const blob = await this.blobs.put({
      ...input,
      bytes: Buffer.from(JSON.stringify(document)),
      mimeType: 'application/vnd.localmind.report+json',
    });
    await this.models.projectReport.retainBlobs({ ...input, keys: [blob.key] });
    return this.models.projectReport.save({
      ...input,
      document,
      blob,
      kind: 'draft',
      reason: 'Apply reviewed AI report candidate',
      sourceManifestId: candidate.sourceManifestId,
      selection: candidate.selection,
      fingerprint: projectResourceHash({
        runId: input.runId,
        document,
        expectedVersion: input.expectedVersion,
      }),
    });
  }

  async validateSources(
    input: ReportActor & {
      document: ReportDocument;
      baseDocument?: ReportDocument;
    }
  ) {
    if (input.baseDocument)
      assertReportEvidenceUnchanged(input.document, input.baseDocument);
    return this.sources.validateSources(input);
  }

  private async readDocument(input: ReportActor & { revisionId?: string }) {
    const revision = await this.models.projectReport.revision(input);
    const stored = await this.blobs.read({
      ...input,
      key: revision.contentBlobKey,
    });
    if (stored.blob.fingerprint !== revision.contentHash)
      throw new BadRequest('Report content fingerprint is invalid');
    return ReportDocumentSchema.parse(
      JSON.parse(stored.bytes.toString('utf8'))
    );
  }

  private async stage<T>(
    lease: ProjectAgentLease,
    key: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    work: () => Promise<T>
  ): Promise<T> {
    const checkpoint = await this.models.projectReportGeneration.checkpoint({
      ...lease,
      key,
    });
    if (checkpoint) {
      const reference = ReportCheckpointSchema.parse(checkpoint);
      const stored = await this.blobs.read({
        ...lease,
        key: reference.blobKey,
      });
      if (stored.blob.fingerprint !== reference.fingerprint)
        throw new BadRequest('Report checkpoint fingerprint is invalid');
      return schema.parse(JSON.parse(stored.bytes.toString('utf8')));
    }
    await this.models.projectReportGeneration.checkpoint({
      ...lease,
      key,
      running: true,
    });
    const value = schema.parse(await work());
    const blob = await this.blobs.put({
      ...lease,
      bytes: Buffer.from(JSON.stringify(value)),
      mimeType:
        (schema as z.ZodTypeAny) === ReportDocumentSchema
          ? 'application/vnd.localmind.report+json'
          : 'application/vnd.localmind.report-checkpoint+json',
    });
    const { command } =
      await this.models.projectReportGeneration.assertLease(lease);
    await this.models.projectReport.retainBlobs({
      ...lease,
      reportId: command.reportId,
      keys: [blob.key],
    });
    await this.models.projectReportGeneration.checkpoint({
      ...lease,
      key,
      output: { blobKey: blob.key, fingerprint: blob.fingerprint },
    });
    return value;
  }

  private async model<T>(
    lease: ProjectAgentLease,
    promptName: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    payload: unknown
  ): Promise<T> {
    await this.models.projectReportGeneration.assertLease(lease);
    if (
      !(
        await this.byok.getProfiles({
          projectId: lease.projectId,
          userId: lease.actorId,
        })
      ).length
    )
      throw new ReportGenerationError('REPORT_PROVIDER_UNAVAILABLE');
    const content = JSON.stringify(payload);
    if (content.length > 48000)
      throw new ReportGenerationError('REPORT_MODEL_INPUT_BUDGET_EXCEEDED');
    const key = await this.models.projectReportGeneration.reserveModelCall({
      ...lease,
      maxCalls: this.config.projectReport.maxModelCalls,
      inputCharacters: content.length,
    });
    const prompt = REPORT_PROMPTS.find(item => item.name === promptName);
    if (!prompt) throw new BadRequest('Report prompt is unavailable');
    await this.models.projectReportGeneration.seedPrompt(prompt);
    const responseSchemaJson = zodToJsonSchema(schema, {
      $refStrategy: 'none',
      target: 'openAi',
    }) as Record<string, unknown>;
    delete responseSchemaJson.$schema;
    const schemaHash = ensurePromptResponseSchemaHash(responseSchemaJson);
    if (!schemaHash) throw new BadRequest('Report response schema is invalid');
    const responseContract = {
      responseSchemaJson,
      schemaHash,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const guard = setInterval(() => {
      void this.models.projectReportGeneration
        .assertLease(lease)
        .catch(() => controller.abort());
    }, 5000);
    try {
      const configuration = await this.models.copilotProjectByok.get();
      const output = await this.prompts
        .runStructured(
          promptName,
          { content },
          {
            modelId: configuration?.modelId,
            responseContract,
            providerOptions: {
              projectId: lease.projectId,
              user: lease.actorId,
              taskId: lease.runId,
              featureKind: 'action',
              quotaBackedRoutesAllowed: false,
              signal: controller.signal,
              maxTokens: 6000,
            },
          }
        )
        .catch(error => {
          throw new ReportGenerationError(
            isInvalidStructuredOutputError(error)
              ? 'REPORT_MODEL_OUTPUT_INVALID'
              : 'REPORT_MODEL_REQUEST_FAILED'
          );
        });
      await this.models.projectReportGeneration.assertLease(lease);
      const parsed = schema.safeParse(output.value);
      if (!parsed.success)
        throw new ReportGenerationError('REPORT_MODEL_OUTPUT_INVALID');
      const value = parsed.data;
      await this.models.projectReportGeneration.checkpoint({
        ...lease,
        key,
        output: {
          inputCharacters: content.length,
          outputFingerprint: reportStableId(value),
        },
      });
      return value;
    } finally {
      clearInterval(guard);
      clearTimeout(timeout);
    }
  }

  private async prepare(run: ProjectAgentRun) {
    const lease = this.models.projectReportGeneration.lease(run);
    const { command, report } =
      await this.models.projectReportGeneration.assertLease(lease);
    const actor = { ...lease, reportId: report.id };
    const base = await this.readDocument({
      ...actor,
      revisionId: command.baselineRevisionId,
    });
    const previousReportId = report.previousReportId,
      previousRevisionId = report.previousRevisionId;
    const previous =
      previousReportId && previousRevisionId
        ? await this.stage(
            lease,
            'previous-baseline',
            ReportDocumentSchema,
            async () => {
              const document = await this.readDocument({
                ...lease,
                reportId: previousReportId,
                revisionId: previousRevisionId,
              });
              // Comparison uses document claims only; a previous report's
              // work orders may belong to another participant.
              await this.sources.validateSources({
                ...lease,
                document: {
                  ...document,
                  sources: document.sources.filter(
                    source => source.kind !== 'work_order'
                  ),
                },
              });
              return document;
            }
          )
        : null;
    const capture = await this.stage(
      lease,
      'discover',
      ReportCaptureSchema,
      () =>
        this.sources.discover(
          {
            ...lease,
            selection: command.selection,
            cutoffAt: command.cutoffAt,
            period: base.period,
          },
          async () => {
            await this.models.projectReportGeneration.assertLease(lease);
          }
        )
    );
    const snapshots = await this.stage(
      lease,
      'capture',
      z.array(ReportTextSnapshotSchema).max(10000),
      async () => {
        const result: ReportTextSnapshot[] = [];
        let remaining = this.config.projectReport.maxTotalCharacters;
        for (const item of capture.resources) {
          const snapshot = await this.stage(
            lease,
            `source:${item.source.id}`,
            ReportTextSnapshotSchema,
            () => this.sources.read(lease, item, remaining)
          );
          result.push(snapshot);
          remaining -= snapshot.text.length;
        }
        return result;
      }
    );
    const background = await this.stage(
      lease,
      'shared-background',
      z.object({
        snapshots: z.array(ReportTextSnapshotSchema).max(1000),
        complete: z.boolean(),
      }),
      () => this.sources.background({ ...lease, cutoffAt: command.cutoffAt })
    );
    const workOrders = await this.stage(
      lease,
      'work-orders',
      z.object({
        snapshots: z.array(ReportTextSnapshotSchema).max(500),
        complete: z.boolean(),
      }),
      () =>
        this.sources.workOrders({
          ...lease,
          cutoffAt: command.cutoffAt,
          period: base.period,
          language: base.language,
        })
    );
    const workOrderSourceIds = new Set(
      workOrders.snapshots.map(snapshot => snapshot.source.id)
    );
    const extracted = await this.stage(
      lease,
      'extract',
      factsSchema,
      async () => {
        const facts: GroundedReportFact[] = [];
        let rejected = 0;
        let budgetExceeded = false;
        for (const snapshot of [
          ...snapshots,
          ...workOrders.snapshots,
          ...background.snapshots,
        ]) {
          if (snapshot.source.status !== 'parsed') continue;
          const chunkSize = this.config.projectReport.modelChunkCharacters;
          for (
            let offset = 0;
            offset < snapshot.text.length;
            offset += chunkSize
          ) {
            const chunk = snapshot.text.slice(offset, offset + chunkSize);
            try {
              const item = await this.stage(
                lease,
                `facts:${snapshot.source.id}:${offset}`,
                factsSchema,
                async () => {
                  const output = await this.model(
                    lease,
                    REPORT_EXTRACTION_PROMPT,
                    ReportExtractionSchema,
                    {
                      sourceId: snapshot.source.id,
                      backgroundOnly: snapshot.source.kind === 'memory',
                      workOrderStatusOnly:
                        snapshot.source.kind === 'work_order',
                      title: snapshot.source.title,
                      period: base.period,
                      changedInPeriod: snapshot.changedInPeriod,
                      text: chunk,
                    }
                  );
                  return {
                    ...groundReportFacts(output, snapshot, chunk),
                    budgetExceeded: false,
                  };
                }
              );
              rejected += item.rejected;
              for (const fact of item.facts)
                if (!facts.some(existing => existing.id === fact.id))
                  facts.push(fact);
            } catch (error) {
              if (
                error instanceof ReportGenerationError &&
                error.code === 'REPORT_MODEL_BUDGET_EXCEEDED'
              ) {
                budgetExceeded = true;
                break;
              }
              throw error;
            }
          }
          if (budgetExceeded) break;
        }
        return { facts, rejected, budgetExceeded };
      }
    );
    const backgroundSourceIds = new Set(
      background.snapshots.map(snapshot => snapshot.source.id)
    );
    const progressFacts = extracted.facts.filter(
      fact => !backgroundSourceIds.has(fact.sourceId)
    );
    const backgroundFacts = extracted.facts.filter(fact =>
      backgroundSourceIds.has(fact.sourceId)
    );
    const conflicts = await this.stage(
      lease,
      'reconcile',
      reconciliationSchema,
      async () => {
        const result: z.infer<typeof reconciliationSchema> = {
          conflicts: [],
          complete: !extracted.budgetExceeded,
          budgetExceeded: extracted.budgetExceeded,
        };
        const seen = new Set<string>();
        // Pair every bounded batch so contradictory facts cannot disappear merely
        // because they landed on distant source pages. A finite call budget is
        // explicit evidence of incomplete reconciliation, never "no conflicts".
        batches: for (let left = 0; left < progressFacts.length; left += 8) {
          if (result.budgetExceeded) break;
          for (let right = left; right < progressFacts.length; right += 8) {
            const facts = [
              ...progressFacts.slice(left, left + 8),
              ...(right === left ? [] : progressFacts.slice(right, right + 8)),
            ];
            if (facts.length < 2) continue;
            try {
              const response = await this.stage(
                lease,
                `conflicts:${left}:${right}`,
                conflictSchema,
                () =>
                  this.model(
                    lease,
                    REPORT_RECONCILIATION_PROMPT,
                    conflictSchema,
                    {
                      facts: facts.map(({ id, quote }) => ({ id, quote })),
                    }
                  )
              );
              const allowed = new Set(facts.map(fact => fact.id));
              for (const conflict of response.conflicts) {
                const key = reportStableId([...conflict.factIds].sort());
                if (
                  conflict.factIds.every(id => allowed.has(id)) &&
                  !seen.has(key)
                ) {
                  seen.add(key);
                  result.conflicts.push(conflict);
                  if (result.conflicts.length >= 200) {
                    result.complete = false;
                    result.budgetExceeded = true;
                    break batches;
                  }
                }
              }
            } catch (error) {
              if (
                error instanceof ReportGenerationError &&
                error.code === 'REPORT_MODEL_BUDGET_EXCEEDED'
              ) {
                result.complete = false;
                result.budgetExceeded = true;
                break batches;
              }
              throw error;
            }
          }
        }
        return result;
      }
    );
    const candidate = await this.stage(
      lease,
      'compose',
      ReportDocumentSchema,
      async () => {
        const document = makeReportEvidenceDocument(base, snapshots, {
          discovered: capture.discovered,
          enumerationComplete: capture.enumerationComplete,
          cutoffAt: command.cutoffAt,
        });
        document.creator = {
          actorId: report.createdByActorId,
          label: report.creatorLabel,
        };
        // Preserve fixed evidence used by locked/manual baseline content.
        document.sources = [
          ...new Map(
            [
              ...base.sources,
              ...document.sources,
              ...workOrders.snapshots.map(snapshot => snapshot.source),
              ...background.snapshots.map(snapshot => snapshot.source),
            ].map(source => [source.id, source])
          ).values(),
        ];
        const template = await this.models.projectReport.templateRevision({
          ...lease,
          revisionId: report.templateRevisionId,
        });
        if (command.operation === 'rewrite') {
          const targets = base.chapters
            .filter(
              chapter =>
                !chapter.locked &&
                (!command.scope.chapterIds ||
                  command.scope.chapterIds.includes(chapter.id))
            )
            .flatMap(chapter =>
              chapter.nodes.filter(
                node =>
                  !node.locked &&
                  (!command.scope.nodeIds ||
                    command.scope.nodeIds.includes(node.id))
              )
            )
            .filter(node => 'text' in node);
          for (let offset = 0; offset < targets.length; offset += 8) {
            const batch = targets.slice(offset, offset + 8);
            const output = await this.stage(
              lease,
              `rewrite:${offset}`,
              rewriteSchema,
              () =>
                this.model(lease, REPORT_REWRITE_PROMPT, rewriteSchema, {
                  instruction: command.instruction,
                  nodes: batch,
                })
            );
            for (const item of output.items) {
              if (!batch.some(node => node.id === item.nodeId))
                throw new BadRequest('Rewrite escaped its selected scope');
              for (const chapter of document.chapters)
                for (const node of chapter.nodes)
                  if (node.id === item.nodeId && 'text' in node) {
                    node.text = item.text;
                    node.claimKind = 'inference';
                  }
            }
          }
        } else {
          document.chapters = base.chapters
            .filter(
              chapter =>
                chapter.locked ||
                (!chapter.id.startsWith('shared-background') &&
                  chapter.id !== 'previous-comparison')
            )
            .map(chapter =>
              chapter.locked
                ? chapter
                : {
                    ...chapter,
                    nodes: chapter.nodes.filter(node => node.locked),
                    notes: '',
                  }
            );
          const assigned = new Set<string>();
          for (
            let offset = 0;
            offset < progressFacts.length &&
            !extracted.budgetExceeded &&
            !conflicts.budgetExceeded;
            offset += 12
          ) {
            const batch = progressFacts.slice(offset, offset + 12);
            const output = await this.stage(
              lease,
              `compose:${offset}`,
              ReportCompositionSchema,
              () =>
                this.model(
                  lease,
                  REPORT_COMPOSITION_PROMPT,
                  ReportCompositionSchema,
                  {
                    chapters: document.chapters.map(chapter => ({
                      id: chapter.id,
                      title: chapter.title,
                    })),
                    templatePreference: template.content.prompt,
                    instruction: command.instruction,
                    period: base.period,
                    language: base.language,
                    audience: base.audience,
                    facts: batch.map(
                      ({ id, quote, kind, state, changedInPeriod }) => ({
                        id,
                        quote,
                        kind,
                        state,
                        changedInPeriod,
                      })
                    ),
                  }
                )
            );
            for (const chapter of output.chapters) {
              const target = document.chapters.find(
                item => item.id === chapter.id
              );
              if (!target || target.locked) continue;
              for (const item of chapter.items) {
                const facts = batch.filter(fact =>
                  item.factIds.includes(fact.id)
                );
                if (
                  !facts.length ||
                  facts.length !== new Set(item.factIds).size
                )
                  throw new BadRequest(
                    'Report composition fabricated an evidence reference'
                  );
                facts.forEach(fact => assigned.add(fact.id));
                const node = reportFactNode(
                  facts,
                  document.creator,
                  item.suggestion ? item.text : undefined,
                  target.id,
                  workOrderSourceIds
                );
                if (!target.nodes.some(existing => existing.id === node.id))
                  target.nodes.push(node);
              }
              if (!target.notes) target.notes = chapter.notes;
            }
          }
          const remainder = progressFacts.filter(
            fact => !assigned.has(fact.id)
          );
          const target = document.chapters.find(chapter => !chapter.locked);
          if (target)
            for (const fact of remainder) {
              const node = reportFactNode(
                [fact],
                document.creator,
                undefined,
                target.id,
                workOrderSourceIds
              );
              if (!target.nodes.some(existing => existing.id === node.id))
                target.nodes.push(node);
            }
        }
        if (
          command.operation !== 'rewrite' &&
          backgroundFacts.length &&
          document.chapters.length < 60 &&
          !document.chapters.some(
            chapter => chapter.id === 'shared-background' && chapter.locked
          )
        )
          document.chapters.push({
            id: `shared-background-${reportStableId(backgroundFacts.map(fact => fact.id)).slice(0, 16)}`,
            title:
              document.language === 'en'
                ? 'Shared background (not progress evidence)'
                : '共享背景（不作为成员进度依据）',
            layout: 'content',
            hidden: false,
            locked: false,
            notes: '',
            nodes: backgroundFacts.map(fact => ({
              ...reportFactNode([fact], document.creator),
              claimKind: 'inference' as const,
            })),
          });
        if (
          !background.complete ||
          background.snapshots.some(
            snapshot => snapshot.truncated || snapshot.historicalGap
          )
        )
          document.issues.push({
            id: 'background-incomplete',
            kind: 'coverage',
            message:
              'Shared background has a time difference or exceeded the background budget; it is not document progress coverage.',
            sourceIds: [],
            nodeIds: [],
          });
        if (
          !workOrders.complete ||
          workOrders.snapshots.some(
            snapshot => snapshot.truncated || snapshot.historicalGap
          )
        )
          document.issues.push({
            id: 'work-orders-incomplete',
            kind: 'coverage',
            message:
              'Work-order status evidence exceeded its budget or changed after the cutoff; only participant-visible work orders that were read are covered.',
            sourceIds: [],
            nodeIds: [],
          });
        if (
          previous &&
          command.operation !== 'rewrite' &&
          document.chapters.length < 60
        ) {
          const comparison = compareReportEvidence(
            previous,
            document,
            // Period comparison is document-to-document; work-order state is
            // reported separately as business_state.
            progressFacts.filter(fact => !workOrderSourceIds.has(fact.sourceId))
          );
          if (comparison.nodes.length) {
            const used = new Set(
              comparison.nodes.flatMap(node => node.sourceIds)
            );
            document.sources = [
              ...new Map(
                [
                  ...document.sources,
                  ...previous.sources.filter(source => used.has(source.id)),
                ].map(source => [source.id, source])
              ).values(),
            ];
            document.chapters.push({
              id: 'previous-comparison',
              title: '与上期比较（候选，保留原文核对）',
              layout: 'content',
              hidden: false,
              locked: false,
              notes: '按来源ID和原文比较；同名不代表同一事项。',
              nodes: comparison.nodes,
            });
          }
          if (comparison.omitted)
            document.issues.push({
              id: 'comparison-budget',
              kind: 'coverage',
              message: `${comparison.omitted} comparison rows exceeded the comparison budget; narrow the period or scope.`,
              sourceIds: [],
              nodeIds: [],
            });
        }
        for (const conflict of conflicts.conflicts) {
          const facts = progressFacts.filter(fact =>
            conflict.factIds.includes(fact.id)
          );
          document.issues.push({
            id: reportStableId(conflict),
            kind: 'conflict',
            message: conflict.message,
            sourceIds: [...new Set(facts.map(fact => fact.sourceId))],
            nodeIds: [],
          });
        }
        if (!conflicts.complete)
          document.issues.push({
            id: 'reconciliation-budget',
            kind: 'coverage',
            message:
              'The configured budget did not cover every cross-document conflict comparison. Review the retained evidence or narrow the source scope; automatic finalization is blocked.',
            sourceIds: [],
            nodeIds: [],
          });
        if (extracted.rejected)
          document.issues.push({
            id: 'rejected-model-evidence',
            kind: 'missing_fact',
            message: `${extracted.rejected} model evidence claims failed exact source validation and were excluded.`,
            sourceIds: [],
            nodeIds: [],
          });
        if (extracted.budgetExceeded)
          document.issues.push({
            id: 'model-call-budget',
            kind: 'coverage',
            message:
              'The model invocation budget was reached; remaining material has not been analyzed.',
            sourceIds: [],
            nodeIds: [],
          });
        if (!progressFacts.length)
          document.issues.push({
            id: 'no-recorded-progress',
            kind: 'missing_fact',
            message:
              'The selected documents do not provide confirmed project progress. Complete the documents or qualify the report.',
            sourceIds: [],
            nodeIds: [],
          });
        return normalizeReportResponsibility(document, document.creator);
      }
    );
    const layout = await this.stage(
      lease,
      'layout',
      ReportDocumentSchema,
      async () => {
        try {
          layoutReport(
            projectReportAudience(candidate, {
              kind: 'internal',
              chapterIds: candidate.chapters
                .filter(chapter => !chapter.hidden)
                .map(chapter => chapter.id),
              includeNotes: false,
              includeSources: false,
            })
          );
        } catch {
          throw new ReportGenerationError('REPORT_LAYOUT_BUDGET_EXCEEDED');
        }
        return candidate;
      }
    );
    const validated = await this.stage(
      lease,
      'validate',
      ReportDocumentSchema,
      async () => {
        await this.sources.validateSources({ ...lease, document: layout });
        return ReportDocumentSchema.parse(layout);
      }
    );
    const blob = await this.blobs.put({
      ...lease,
      bytes: Buffer.from(JSON.stringify(validated)),
      mimeType: 'application/vnd.localmind.report+json',
    });
    const manifestBlob = await this.blobs.put({
      ...lease,
      bytes: Buffer.from(
        JSON.stringify({
          version: 1,
          selection: command.selection,
          cutoffAt: command.cutoffAt,
          coverage: validated.coverage,
          enumerationComplete: capture.enumerationComplete,
          snapshots,
          background,
          workOrders,
          facts: extracted.facts,
          previousReportId: report.previousReportId,
          previousRevisionId: report.previousRevisionId,
          workOrderPolicy: 'participant_status_metadata_only',
          extractorVersion: 'project-report-source/v1',
        })
      ),
      mimeType: 'application/vnd.localmind.report-sources+json',
    });
    await this.models.projectReport.retainBlobs({
      ...lease,
      reportId: command.reportId,
      keys: [
        blob.key,
        manifestBlob.key,
        ...validated.assets.map(asset => asset.blobKey),
      ],
    });
    return async (leased: ProjectAgentRun) => {
      const finalLease = this.models.projectReportGeneration.lease(leased);
      const result = await this.models.projectReportGeneration.persistCandidate(
        {
          ...finalLease,
          blob,
          manifestBlob,
          coverage: json(validated.coverage),
        }
      );
      await this.models.projectReportGeneration.checkpoint({
        ...finalLease,
        key: 'persist',
        output: result,
      });
      return { reportId: report.id, ...result };
    };
  }
}
