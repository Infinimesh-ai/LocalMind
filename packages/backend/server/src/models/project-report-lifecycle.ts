import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { AccessDenied, BadRequest, ResourceConflict } from '../base';
import { BaseModel } from './base';
import type { ReportActor } from './project-report';
import { projectResourceHash } from './project-resource';

export const REPORT_PURGE_DELAY_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
export type ReportPurgeLease = { reportId: string; leaseId: string };

// Every ProjectBlob consumer participates: a report purge never deletes an
// original resource, another report, a session attachment or an Office copy.
const unreferenced: Prisma.ProjectBlobWhereInput = {
  revisions: { none: {} },
  attachments: { none: {} },
  officeSources: { none: {} },
  officePackages: { none: {} },
  officeStates: { none: {} },
  officeCommands: { none: {} },
  sessionContextReferences: { none: {} },
  reportRevisions: { none: {} },
  reportManifests: { none: {} },
  reportExports: { none: {} },
  reportShareRevisions: { none: {} },
  reportReferences: { none: {} },
};

@Injectable()
export class ProjectReportLifecycleModel extends BaseModel {
  @Transactional()
  async request(
    input: ReportActor & { expectedVersion: number; requestKey: string }
  ) {
    await this.models.projectResource.assertMember(input, true);
    await this.db
      .$queryRaw`SELECT id FROM project_reports WHERE id=${input.reportId} AND project_id=${input.projectId} FOR UPDATE`;
    const fingerprint = projectResourceHash({
      reportId: input.reportId,
      expectedVersion: input.expectedVersion,
    });
    const key = z.string().trim().min(1).max(256).parse(input.requestKey);
    const previous = await this.db.projectReportDeletion.findUnique({
      where: { reportId: input.reportId },
    });
    if (previous) {
      if (
        previous.projectId !== input.projectId ||
        previous.actorId !== input.actorId ||
        previous.requestKey !== key ||
        previous.fingerprint !== fingerprint
      )
        throw new BadRequest(
          'Report deletion request differs from its immutable receipt'
        );
      return previous;
    }
    const report = await this.db.projectReport.findFirst({
      where: { id: input.reportId, projectId: input.projectId },
    });
    if (!report) throw new AccessDenied('Project report is unavailable');
    if (report.lifecycle !== 'trashed')
      throw new BadRequest(
        'Move the report to trash before permanently deleting it'
      );
    if (report.version !== input.expectedVersion)
      throw new ResourceConflict('Report changed before deletion');
    const now = await this.now();
    if (
      await this.db.projectReportEditLease.findFirst({
        where: { reportId: report.id, expiresAt: { gt: now } },
      })
    )
      throw new ResourceConflict('Report is still being edited');
    const held = await this.retentionHeld();
    await this.models.copilotProjectAgentRuntime.cancelReportRuns(input);
    await this.models.projectReportSchedule.pauseForReport(input);
    await this.stopReportDistribution(input.reportId);
    const deletion = await this.db.projectReportDeletion.create({
      data: {
        reportId: report.id,
        projectId: report.projectId,
        actorId: input.actorId,
        expectedVersion: input.expectedVersion,
        requestKey: key,
        fingerprint,
        status: held ? 'held' : 'requested',
        eligibleAt: new Date(now.getTime() + REPORT_PURGE_DELAY_MS),
        failureCode: held ? 'RETENTION_HOLD' : null,
        holdReason: held ? 'RETENTION_HOLD' : null,
        heldAt: held ? now : null,
      },
    });
    await this.db.projectReport.update({
      where: { id: report.id },
      data: { version: { increment: 1 } },
    });
    await this.models.projectReport.record({
      ...input,
      requestKey: key,
      fingerprint,
      operation: 'permanently_delete',
      result: {
        reportId: report.id,
        status: deletion.status,
        eligibleAt: deletion.eligibleAt.toISOString(),
      },
    });
    return deletion;
  }

  @Transactional()
  async due(limit = 20) {
    const now = await this.now();
    return this.db.projectReportDeletion.findMany({
      where: {
        status: { not: 'purged' },
        eligibleAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      select: { reportId: true },
      // A repeatedly failing object must not starve unrelated deletions.
      orderBy: [{ attempts: 'asc' }, { eligibleAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  @Transactional()
  async claim(reportId: string) {
    const held = await this.retentionHeld();
    await this.db
      .$queryRaw`SELECT report_id FROM project_report_deletions WHERE report_id=${reportId} FOR UPDATE`;
    const current = await this.db.projectReportDeletion.findUnique({
      where: { reportId },
    });
    const now = await this.now();
    if (
      !current ||
      current.status === 'purged' ||
      current.eligibleAt > now ||
      (current.leaseExpiresAt && current.leaseExpiresAt > now)
    )
      return null;
    if (held) {
      await this.db.projectReportDeletion.update({
        where: { reportId },
        data: {
          status: 'held',
          failureCode: 'RETENTION_HOLD',
          holdReason: 'RETENTION_HOLD',
          heldAt: current.heldAt ?? now,
          leaseId: null,
          leaseExpiresAt: null,
        },
      });
      return null;
    }
    return this.db.projectReportDeletion.update({
      where: { reportId },
      data: {
        status: 'purging',
        leaseId: randomUUID(),
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        attempts: { increment: 1 },
        failureCode: null,
        holdReason: null,
        releasedAt: current.status === 'held' ? now : current.releasedAt,
      },
    });
  }

  /** Detach content in one transaction; only then may object storage be touched. */
  @Transactional<TransactionalAdapterPrisma>({ timeout: 60000 })
  async prepare(input: ReportPurgeLease) {
    if (await this.retentionHeld()) {
      await this.hold(input);
      return false;
    }
    const deletion = await this.lockLease(input);
    const reportId = deletion.reportId;
    await this.db
      .$queryRaw`SELECT id FROM project_reports WHERE id=${reportId} FOR UPDATE`;
    const report = await this.db.projectReport.findUniqueOrThrow({
      where: { id: reportId },
    });
    if (report.lifecycle !== 'trashed')
      throw new ResourceConflict('Deleted report lifecycle changed');
    const candidates = await this.db.$queryRaw<{ key: string }[]>(Prisma.sql`
      SELECT content_blob_key AS key FROM project_report_revisions WHERE report_id=${reportId}
      UNION SELECT blob_key FROM project_report_source_manifests WHERE report_id=${reportId}
      UNION SELECT blob_key FROM project_report_exports WHERE report_id=${reportId} AND blob_key IS NOT NULL
      UNION SELECT projection_blob_key FROM project_report_share_revisions WHERE report_id=${reportId}
      UNION SELECT blob_key FROM project_report_blob_references WHERE report_id=${reportId}
    `);
    for (let offset = 0; offset < candidates.length; offset += 500) {
      await this.db.projectReportBlobDeletion.createMany({
        data: candidates.slice(offset, offset + 500).map(({ key }) => ({
          reportId,
          projectId: deletion.projectId,
          blobKey: key,
        })),
        skipDuplicates: true,
      });
    }
    const revisions = await this.db.projectReportRevision.findMany({
      where: { reportId },
      select: { id: true, kind: true, sequence: true, contentHash: true },
    });
    const exports = await this.db.projectReportExport.findMany({
      where: { reportId },
      select: {
        id: true,
        format: true,
        resourceId: true,
        status: true,
        revisionId: true,
      },
    });
    const occurrences = await this.db.projectReportOccurrence.findMany({
      where: { reportId, reportRevisionId: { not: null } },
      select: { id: true, reportRevisionId: true },
    });
    const comparisons = await this.db.projectReport.findMany({
      where: { previousReportId: reportId },
      select: { id: true, previousRevisionId: true },
    });
    // Content is removed but immutable receipt identifiers and checksums remain
    // explainable. No title, responsibility label, source text or notes survive.
    const evidence: Prisma.ProjectReportAuditEventCreateManyInput[] = [
      ...revisions.map(row => ({
        projectId: deletion.projectId,
        reportId,
        actorId: deletion.actorId,
        action: 'purge.revision_evidence',
        evidence: row,
      })),
      ...exports.map(row => ({
        projectId: deletion.projectId,
        reportId,
        actorId: deletion.actorId,
        action: 'purge.export_evidence',
        evidence: row,
      })),
      ...occurrences.map(row => ({
        projectId: deletion.projectId,
        reportId,
        actorId: deletion.actorId,
        action: 'purge.occurrence_evidence',
        evidence: row,
      })),
      ...comparisons.map(row => ({
        projectId: deletion.projectId,
        reportId: row.id,
        actorId: deletion.actorId,
        action: 'previous_source.purged',
        evidence: {
          previousReportId: reportId,
          previousRevisionId: row.previousRevisionId,
        },
      })),
    ];
    for (let offset = 0; offset < evidence.length; offset += 500)
      await this.db.projectReportAuditEvent.createMany({
        data: evidence.slice(offset, offset + 500),
      });
    await this.db
      .$executeRaw`SELECT set_config('localmind.allow_report_purge', 'on', true)`;
    await this.stopReportDistribution(reportId);
    await this.db.projectReportShare.updateMany({
      where: { reportId },
      data: { currentRevisionId: null },
    });
    await this.db.projectReportOccurrence.updateMany({
      where: { reportId },
      data: { reportRevisionId: null },
    });
    await this.db.projectReport.updateMany({
      where: { previousReportId: reportId },
      data: { previousRevisionId: null, previousReportId: null },
    });
    await this.db.projectReport.update({
      where: { id: reportId },
      data: {
        draftRevisionId: null,
        latestFinalRevisionId: null,
        previousReportId: null,
        previousRevisionId: null,
        title: '已删除汇报',
        creatorLabel: '已删除汇报',
        responsibility: Prisma.JsonNull,
        selection: { kind: 'all' },
        version: { increment: 1 },
      },
    });
    await this.db.projectReportEditLease.deleteMany({ where: { reportId } });
    await this.db.projectReportComment.deleteMany({ where: { reportId } });
    await this.db.projectReportReview.deleteMany({ where: { reportId } });
    await this.db.projectReportShareRevision.deleteMany({
      where: { reportId },
    });
    // Share IDs remain revoked tombstones so sent delivery receipts still resolve.
    await this.db.projectReportExport.deleteMany({ where: { reportId } });
    await this.db.projectReportRevision.deleteMany({ where: { reportId } });
    await this.db.projectReportSourceManifest.deleteMany({
      where: { reportId },
    });
    await this.db.projectReportBlobReference.deleteMany({
      where: { reportId },
    });
    await this.db.projectReportDeletion.update({
      where: { reportId },
      data: {
        leaseExpiresAt: new Date((await this.now()).getTime() + LEASE_MS),
      },
    });
    return true;
  }

  async deleteNextBlob(
    input: ReportPurgeLease,
    remove: (projectId: string, key: string) => Promise<void>
  ) {
    const reservation = await this.reserveBlob(input);
    if (!reservation) return false;
    if (reservation === true) return true;
    return this.deleteReservedBlob(input, reservation.id, remove);
  }

  /** Commit the deletion marker before touching nontransactional storage. */
  @Transactional()
  async reserveBlob(input: ReportPurgeLease) {
    if (await this.retentionHeld()) {
      await this.hold(input);
      return false;
    }
    await this.lockLease(input);
    const candidate = await this.db.projectReportBlobDeletion.findFirst({
      where: { reportId: input.reportId, status: 'pending' },
      orderBy: { id: 'asc' },
    });
    if (!candidate) return false;
    const pendingId = `report:${input.reportId}`;
    // Existing native resource writers hold the Project lock for their entire
    // transaction. Serialize the fence with those writers before taking Blob locks.
    await this.db
      .$queryRaw`SELECT id FROM ai_context_projects WHERE id=${candidate.projectId} FOR UPDATE`;
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'project-blob:' + candidate.projectId + ':' + candidate.blobKey}, 0))`;
    await this.db
      .$queryRaw`SELECT key FROM project_blobs WHERE project_id=${candidate.projectId} AND key=${candidate.blobKey} FOR UPDATE`;
    const blob = await this.db.projectBlob.findUnique({
      where: {
        projectId_key: {
          projectId: candidate.projectId,
          key: candidate.blobKey,
        },
      },
    });
    if (!blob) {
      await this.finishBlob(candidate.id, 'deleted');
      return true;
    }
    const available = await this.db.projectBlob.findFirst({
      where: {
        projectId: candidate.projectId,
        key: candidate.blobKey,
        ...unreferenced,
        OR: [{ pendingDeletionId: null }, { pendingDeletionId: pendingId }],
      },
    });
    if (!available) {
      await this.finishBlob(candidate.id, 'retained');
      return true;
    }
    if (!blob.pendingDeletionId)
      await this.db.projectBlob.update({
        where: {
          projectId_key: {
            projectId: candidate.projectId,
            key: candidate.blobKey,
          },
        },
        data: {
          pendingDeletionId: pendingId,
          deletionPendingAt: await this.now(),
        },
      });
    return candidate;
  }

  /** Storage callback runs while the policy and GC claim are locked. */
  @Transactional<TransactionalAdapterPrisma>({ timeout: 60000 })
  async deleteReservedBlob(
    input: ReportPurgeLease,
    candidateId: string,
    remove: (projectId: string, key: string) => Promise<void>
  ) {
    if (await this.retentionHeld()) {
      await this.hold(input);
      return false;
    }
    const deletion = await this.lockLease(input);
    const candidate = await this.db.projectReportBlobDeletion.findFirst({
      where: { id: candidateId, reportId: input.reportId, status: 'pending' },
    });
    if (!candidate) return true;
    const pendingId = `report:${input.reportId}`;
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'project-blob:' + candidate.projectId + ':' + candidate.blobKey}, 0))`;
    await this.db
      .$queryRaw`SELECT key FROM project_blobs WHERE project_id=${candidate.projectId} AND key=${candidate.blobKey} FOR UPDATE`;
    const available = await this.db.projectBlob.findFirst({
      where: {
        projectId: candidate.projectId,
        key: candidate.blobKey,
        pendingDeletionId: pendingId,
        ...unreferenced,
      },
    });
    if (!available)
      throw new ResourceConflict(
        'Report Blob deletion reservation is unavailable'
      );
    await remove(candidate.projectId, candidate.blobKey);
    await this.db
      .$executeRaw`SELECT set_config('localmind.report_blob_delete_id', ${pendingId}, true)`;
    const removed = await this.db.projectBlob.deleteMany({
      where: {
        projectId: candidate.projectId,
        key: candidate.blobKey,
        pendingDeletionId: pendingId,
        ...unreferenced,
      },
    });
    if (removed.count !== 1)
      throw new ResourceConflict(
        'Report Blob references changed during collection'
      );
    await this.finishBlob(candidate.id, 'deleted');
    await this.db.projectReportDeletion.update({
      where: { reportId: deletion.reportId },
      data: {
        leaseExpiresAt: new Date((await this.now()).getTime() + LEASE_MS),
      },
    });
    return true;
  }

  @Transactional()
  async finish(input: ReportPurgeLease) {
    if (await this.retentionHeld()) {
      await this.hold(input);
      return false;
    }
    const deletion = await this.lockLease(input);
    if (
      await this.db.projectReportBlobDeletion.count({
        where: { reportId: input.reportId, status: 'pending' },
      })
    )
      return false;
    await this.db.projectReportDeletion.update({
      where: { reportId: input.reportId },
      data: {
        status: 'purged',
        completedAt: await this.now(),
        leaseId: null,
        leaseExpiresAt: null,
        failureCode: null,
        holdReason: null,
      },
    });
    await this.db.projectReportAuditEvent.create({
      data: {
        projectId: deletion.projectId,
        reportId: deletion.reportId,
        actorId: deletion.actorId,
        action: 'purge.completed',
        evidence: { contentRemoved: true },
      },
    });
    return true;
  }

  @Transactional()
  async retry(input: ReportPurgeLease) {
    return this.db.projectReportDeletion.updateMany({
      where: {
        reportId: input.reportId,
        leaseId: input.leaseId,
        status: 'purging',
      },
      data: {
        status: 'requested',
        leaseId: null,
        leaseExpiresAt: null,
        failureCode: 'PURGE_RETRY',
      },
    });
  }

  @Transactional()
  async pauseDeletedActor(actorId: string) {
    // This event is an identity revocation, never an implicit reassignment.
    await this.db.projectReportSchedule.updateMany({
      where: { actorId, status: 'active' },
      data: { status: 'paused', version: { increment: 1 } },
    });
    await this.db.projectReportShare.updateMany({
      where: { actorId, status: 'active' },
      data: {
        status: 'revoked',
        revokedAt: await this.now(),
        version: { increment: 1 },
      },
    });
    await this.db.projectReportOccurrence.updateMany({
      where: {
        actorId,
        status: { in: ['queued', 'generating', 'finalizing'] },
      },
      data: {
        status: 'paused',
        failureCode: 'ACTOR_DELETED',
        version: { increment: 1 },
      },
    });
    await this.db.projectReportDelivery.updateMany({
      where: { occurrence: { actorId }, status: 'queued' },
      data: {
        status: 'cancelled',
        resultNote: 'ACTOR_DELETED',
        version: { increment: 1 },
      },
    });
    await this.db.projectReportDelivery.updateMany({
      where: { occurrence: { actorId }, status: 'sending' },
      data: {
        status: 'unknown',
        resultNote: 'ACTOR_DELETED_DURING_SEND',
        leaseId: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
  }

  private async stopReportDistribution(reportId: string) {
    await this.db.projectReportShare.updateMany({
      where: { reportId, status: 'active' },
      data: {
        status: 'revoked',
        revokedAt: await this.now(),
        version: { increment: 1 },
      },
    });
    await this.db.projectReportOccurrence.updateMany({
      where: {
        reportId,
        status: { in: ['queued', 'generating', 'finalizing'] },
      },
      data: {
        status: 'paused',
        failureCode: 'REPORT_DELETED',
        version: { increment: 1 },
      },
    });
    await this.db.projectReportDelivery.updateMany({
      where: { occurrence: { reportId }, status: 'queued' },
      data: {
        status: 'cancelled',
        resultNote: 'REPORT_DELETED',
        version: { increment: 1 },
      },
    });
    await this.db.projectReportDelivery.updateMany({
      where: { occurrence: { reportId }, status: 'sending' },
      data: {
        status: 'unknown',
        resultNote: 'REPORT_DELETED_DURING_SEND',
        leaseId: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
  }

  private async retentionHeld() {
    await this.db.localMindLogPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    const [policy] = await this.db.$queryRaw<
      { legal_hold: boolean; retention_frozen: boolean }[]
    >`SELECT legal_hold, retention_frozen FROM localmind_log_policies WHERE id='default' FOR SHARE`;
    return policy.legal_hold || policy.retention_frozen;
  }
  private async lockLease(input: ReportPurgeLease) {
    await this.db
      .$queryRaw`SELECT report_id FROM project_report_deletions WHERE report_id=${input.reportId} FOR UPDATE`;
    const deletion = await this.db.projectReportDeletion.findFirst({
      where: {
        reportId: input.reportId,
        leaseId: input.leaseId,
        status: 'purging',
        leaseExpiresAt: { gt: await this.now() },
      },
    });
    if (!deletion)
      throw new ResourceConflict('Report deletion worker lease expired');
    return deletion;
  }
  private async hold(input: ReportPurgeLease) {
    await this.db.projectReportDeletion.updateMany({
      where: {
        reportId: input.reportId,
        leaseId: input.leaseId,
        status: 'purging',
      },
      data: {
        status: 'held',
        failureCode: 'RETENTION_HOLD',
        holdReason: 'RETENTION_HOLD',
        heldAt: await this.now(),
        leaseId: null,
        leaseExpiresAt: null,
      },
    });
  }
  private async finishBlob(id: string, status: 'deleted' | 'retained') {
    await this.db.projectReportBlobDeletion.update({
      where: { id },
      data: { status, completedAt: await this.now() },
    });
  }
  private async now() {
    const [row] = await this.db.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    return row.now;
  }
}
