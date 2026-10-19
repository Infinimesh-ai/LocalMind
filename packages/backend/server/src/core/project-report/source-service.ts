import '../../plugins/copilot/report-config';

import { createHash } from 'node:crypto';

import {
  type ReportDocument,
  ReportSelectionSchema,
  type ReportSource,
} from '@localmind/office/report';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BadRequest, Config } from '../../base';
import { Models } from '../../models';
import {
  type CapturedReportResource,
  type ReportCapture,
  type ReportTextSnapshot,
  workOrderEvidenceText,
} from '../../models/project-report-generation-contract';
import {
  type ProjectActor,
  projectResourceHash,
} from '../../models/project-resource';
import { OfficeArtifactService } from '../office';
import { ProjectResourceService } from '../project';
import { readPdfText, readProjectResourceText } from './resource-text';

@Injectable()
export class ProjectReportSourceService {
  constructor(
    private readonly models: Models,
    private readonly resources: ProjectResourceService,
    private readonly office: OfficeArtifactService,
    private readonly config: Config
  ) {}

  async discover(
    input: ProjectActor & {
      selection: z.infer<typeof ReportSelectionSchema>;
      cutoffAt: string;
      period: ReportDocument['period'];
    },
    progress: (count: number) => Promise<void> = async () => {}
  ): Promise<ReportCapture> {
    const selection = ReportSelectionSchema.parse(input.selection);
    const excluded =
      await this.models.projectReportGeneration.reportExportResourceIds(input);
    const ids = new Set<string>();
    const queue: (string | null)[] =
      selection.kind === 'folders'
        ? [...selection.folderIds]
        : selection.kind === 'all'
          ? [null]
          : [];
    if (selection.kind === 'resources')
      for (const id of selection.resourceIds) ids.add(id);
    const seen = new Set<string | null>();
    let complete = true;
    let omittedReportExports = 0;
    // Page every selected container. Never use a top-k search as full coverage.
    while (queue.length) {
      const parentId = queue.shift() ?? null;
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      let cursor: string | null = null;
      do {
        const page = await this.models.projectResource.list({
          ...input,
          parentId,
          cursor,
          limit: 100,
        });
        for (const row of page.items) {
          if (row.kind === 'folder') queue.push(row.id);
          else if (excluded.has(row.id)) omittedReportExports++;
          else ids.add(row.id);
        }
        await progress(ids.size);
        cursor = page.nextCursor;
        if (
          ids.size >= this.config.projectReport.maxResources ||
          seen.size > 10000
        ) {
          complete = !cursor && !queue.length;
          queue.length = 0;
          cursor = null;
          break;
        }
      } while (cursor);
    }
    const selected = [...ids].filter(id => !excluded.has(id));
    if (selected.length > this.config.projectReport.maxResources)
      complete = false;
    const resources: CapturedReportResource[] = [];
    for (const resourceId of selected.slice(
      0,
      this.config.projectReport.maxResources
    )) {
      // Fail on revoked or cross-project IDs rather than describing their names.
      const captured =
        await this.models.projectReportGeneration.captureResource({
          ...input,
          resourceId,
          cutoffAt: new Date(input.cutoffAt),
          periodStart: new Date(input.period.start),
          periodEnd: new Date(input.period.end),
        });
      const identity = createHash('sha256')
        .update(
          `${resourceId}:${captured.revisionId}:${captured.fingerprint}:${input.cutoffAt}`
        )
        .digest('hex');
      resources.push({
        source: {
          id: identity,
          resourceId,
          title: captured.resource.title,
          kind: captured.resource.kind as ReportSource['kind'],
          revision: captured.revisionId,
          fingerprint: captured.fingerprint,
          capturedAt: new Date().toISOString(),
          locator: `revision:${captured.revisionId}`,
          status: 'read',
        },
        sequence: captured.sequence,
        artifactId: captured.resource.officeArtifactId ?? undefined,
        blobKey: captured.blobKey,
        changedInPeriod: captured.changedInPeriod,
        historicalGap: captured.historicalGap,
      });
    }
    return {
      resources,
      discovered: selected.length,
      enumerationComplete: complete,
      omittedReportExports,
    };
  }

  async background(input: ProjectActor & { cutoffAt: string }) {
    const snapshots: ReportTextSnapshot[] = [];
    let cursor: string | undefined;
    let remaining = Math.min(
      100000,
      this.config.projectReport.maxTotalCharacters
    );
    let complete = true;
    do {
      const page = await this.models.projectReportGeneration.sharedBackground({
        ...input,
        cursor,
        limit: 100,
      });
      for (const memory of page.items) {
        const text = memory.content.slice(
          0,
          Math.max(0, Math.min(remaining, 12000))
        );
        const fingerprint = projectResourceHash({
          content: memory.content,
          revision: memory.revision,
        });
        snapshots.push({
          source: {
            id: projectResourceHash({
              id: memory.id,
              revision: memory.revision,
              fingerprint,
              cutoffAt: input.cutoffAt,
            }),
            resourceId: memory.id,
            title: 'Shared project background',
            kind: 'memory',
            revision: String(memory.revision),
            fingerprint,
            capturedAt: new Date().toISOString(),
            locator: `shared-memory:${memory.revision}`,
            status: text ? 'parsed' : 'omitted',
            ...(text.length < memory.content.length
              ? { reason: 'background_text_budget' }
              : {}),
          },
          text,
          changedInPeriod: false,
          historicalGap: memory.updatedAt > new Date(input.cutoffAt),
          truncated: text.length < memory.content.length,
        });
        remaining -= text.length;
      }
      cursor = page.nextCursor ?? undefined;
      if (snapshots.length >= 1000) {
        complete = !cursor;
        break;
      }
    } while (cursor);
    return { snapshots, complete };
  }

  /**
   * Work orders from this project where the actor is a participant, rendered as
   * deterministic server-built status text. Delivery content never appears.
   */
  async workOrders(
    input: ProjectActor & {
      cutoffAt: string;
      period: ReportDocument['period'];
      language?: ReportDocument['language'];
    }
  ) {
    const snapshots: ReportTextSnapshot[] = [];
    let cursor: string | undefined;
    let remaining = Math.min(
      100000,
      this.config.projectReport.maxTotalCharacters
    );
    let complete = true;
    const start = new Date(input.period.start);
    const end = new Date(input.period.end);
    const inPeriod = (value: string | null) =>
      !!value && new Date(value) >= start && new Date(value) < end;
    do {
      const page = await this.models.projectReportGeneration.workOrderEvidence({
        ...input,
        cursor,
        limit: 100,
      });
      for (const order of page.items) {
        const full = workOrderEvidenceText(order, input.language);
        const text = remaining >= full.length ? full : '';
        snapshots.push({
          source: {
            id: projectResourceHash({
              id: order.id,
              revision: order.revision,
              fingerprint: order.fingerprint,
              cutoffAt: input.cutoffAt,
            }),
            resourceId: order.id,
            title: `${input.language === 'en' ? 'Work order' : '工单'}: ${order.title}`,
            kind: 'work_order',
            revision: order.revision,
            fingerprint: order.fingerprint,
            capturedAt: new Date().toISOString(),
            locator: `work-order:${order.version}`,
            status: text ? 'parsed' : 'omitted',
            ...(text ? {} : { reason: 'work_order_text_budget' }),
          },
          text,
          changedInPeriod:
            inPeriod(order.updatedAt) || inPeriod(order.completedAt),
          historicalGap: new Date(order.updatedAt) > new Date(input.cutoffAt),
          truncated: !text,
        });
        remaining -= text.length;
      }
      cursor = page.nextCursor ?? undefined;
      if (snapshots.length >= 500) {
        complete = !cursor;
        break;
      }
    } while (cursor);
    return { snapshots, complete };
  }

  async read(
    input: ProjectActor,
    captured: CapturedReportResource,
    remainingCharacters: number
  ): Promise<ReportTextSnapshot> {
    await this.models.projectResource.get({
      ...input,
      resourceId: captured.source.resourceId,
    });
    const budget = Math.min(
      this.config.projectReport.maxSourceCharacters,
      remainingCharacters
    );
    const result: ReportTextSnapshot = {
      source: { ...captured.source },
      text: '',
      changedInPeriod: captured.changedInPeriod,
      historicalGap: captured.historicalGap,
      truncated: false,
    };
    if (budget <= 0)
      return {
        ...result,
        source: {
          ...result.source,
          status: 'omitted',
          reason: 'total_text_budget',
        },
        truncated: true,
      };
    try {
      const { text, truncated } = await readProjectResourceText(
        {
          models: this.models,
          resources: this.resources,
          office: this.office,
          readPdf: (bytes, budget) => this.readPdf(bytes, budget),
        },
        input,
        {
          resourceId: captured.source.resourceId,
          kind: captured.source.kind,
          revision: captured.source.revision,
          sequence: captured.sequence,
          artifactId: captured.artifactId,
        },
        budget
      );
      await this.models.projectResource.get({
        ...input,
        resourceId: captured.source.resourceId,
      });
      const status = text.trim() ? 'parsed' : 'failed';
      return {
        ...result,
        text: text.slice(0, budget),
        truncated,
        source: {
          ...result.source,
          status,
          ...(!text.trim()
            ? {
                reason:
                  captured.source.kind === 'pdf'
                    ? 'no_extractable_text_ocr_unavailable'
                    : 'no_extractable_text',
              }
            : truncated
              ? { reason: 'source_text_budget' }
              : {}),
        },
      };
    } catch {
      // Re-check authorization separately: access revocation must stop the run.
      await this.models.projectResource.get({
        ...input,
        resourceId: captured.source.resourceId,
      });
      return {
        ...result,
        source: {
          ...result.source,
          status: 'failed',
          reason: 'unsupported_encrypted_or_damaged_source',
        },
      };
    }
  }

  async validateSources(input: ProjectActor & { document: ReportDocument }) {
    for (const source of input.document.sources) {
      if (source.kind === 'memory') {
        await this.models.projectReportGeneration.validateSharedBackground({
          ...input,
          id: source.resourceId,
          revision: source.revision,
          fingerprint: source.fingerprint,
        });
        continue;
      }
      if (source.kind === 'work_order') {
        await this.models.projectReportGeneration.validateWorkOrderEvidence({
          ...input,
          id: source.resourceId,
          revision: source.revision,
          fingerprint: source.fingerprint,
        });
        continue;
      }
      const resource = await this.models.projectResource.get({
        ...input,
        resourceId: source.resourceId,
      });
      if (resource.officeArtifactId) {
        const revision = await this.office.getRevision(
          { projectId: input.projectId },
          input.actorId,
          resource.officeArtifactId,
          source.revision
        );
        if (revision.packageFingerprint !== source.fingerprint)
          throw new BadRequest('Report source fingerprint changed');
      } else {
        const sequence = Number(source.revision);
        if (!Number.isSafeInteger(sequence) || sequence < 1)
          throw new BadRequest('Invalid report source revision');
        const revision = await this.models.projectResource.revision({
          ...input,
          resourceId: source.resourceId,
          sequence,
        });
        const blob = await this.models.projectResource.getBlob({
          ...input,
          key: revision.blobKey,
        });
        if (blob.fingerprint !== source.fingerprint)
          throw new BadRequest('Report source fingerprint changed');
      }
    }
  }

  private async readPdf(bytes: Uint8Array, budget: number) {
    return readPdfText(bytes, budget);
  }
}
