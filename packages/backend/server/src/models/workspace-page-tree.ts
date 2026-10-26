import { randomUUID } from 'node:crypto';

import {
  WORKSPACE_PAGE_TREE_CONTRACT,
  WORKSPACE_PAGE_TREE_V1_CONTRACT,
} from '@affine/graphql';
import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import type { Prisma } from '@prisma/client';

import { BadRequest, ResourceConflict } from '../base';
import { BaseModel } from './base';
import {
  permissionDocumentLockKey,
  permissionWorkspaceLockKey,
} from './permission-write';

@Injectable()
export class WorkspacePageTreeModel extends BaseModel {
  async conversionAudience(workspaceId: string) {
    return (await this.conversionAudienceBlocker(workspaceId)) === null;
  }
  /** Why converted pages could not keep the folder's effective audience. */
  async conversionAudienceBlocker(workspaceId: string) {
    const policy = await this.db.workspaceAccessPolicy.findUnique({
      where: { workspaceId },
    });
    if ((policy?.visibility ?? 'private') !== 'private')
      return 'public_workspace' as const;
    if ((policy?.memberDefaultDocRole ?? 'manager') !== 'manager')
      return 'default_role_not_manager' as const;
    return null;
  }
  async recordedResource(workspaceId: string, resourceId: string) {
    return this.db.workspacePageTreeOperation.findFirst({
      where: {
        workspaceId,
        result: { path: ['resource', 'resourceId'], equals: resourceId },
      },
      select: { id: true },
    });
  }
  async lockDocuments(workspaceId: string, docIds: string[]) {
    for (const id of [...new Set(docIds)].sort()) {
      await this.db
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${permissionDocumentLockKey(workspaceId, id)}, 0))`;
    }
  }

  /** A bounded fingerprint of every authority that can change tree visibility.
   * The result contains no principal or resource information. */
  async authorizationVersion(
    workspaceId: string,
    excludeDocIds: string[] = []
  ) {
    const [row] = await this.db.$queryRaw<Array<{ revision: string }>>`
      SELECT md5(COALESCE(string_agg(value, ',' ORDER BY value), '')) AS revision
      FROM (
        SELECT 'member:' || md5(jsonb_build_array(m.user_id, m.role, m.state)::text) AS value FROM workspace_members m WHERE workspace_id = ${workspaceId}
        UNION ALL SELECT 'workspace:' || md5(jsonb_build_array(COALESCE(p.visibility, 'private'), COALESCE(p.sharing_enabled, true), COALESCE(p.member_default_doc_role, 'manager'))::text) FROM workspaces w LEFT JOIN workspace_access_policies p ON p.workspace_id = w.id WHERE w.id = ${workspaceId}
        UNION ALL SELECT 'doc:' || md5(jsonb_build_array(p.doc_id, p.visibility, p.public_role, p.member_default_role)::text) FROM doc_access_policies p WHERE workspace_id = ${workspaceId} AND doc_id <> ${workspaceId} AND doc_id NOT LIKE 'db$%' AND doc_id NOT LIKE 'userdata$%' AND NOT (doc_id = ANY(${excludeDocIds}::text[]))
        UNION ALL SELECT 'grant:' || md5(jsonb_build_array(g.doc_id, g.principal_type, g.principal_id, g.role)::text) FROM doc_grants g WHERE workspace_id = ${workspaceId} AND doc_id <> ${workspaceId} AND doc_id NOT LIKE 'db$%' AND doc_id NOT LIKE 'userdata$%' AND NOT (doc_id = ANY(${excludeDocIds}::text[]))
      ) authority
    `;
    return row.revision;
  }
  async activeToolRuns(workspaceId: string) {
    const runs = [];
    let after: string | undefined;
    do {
      const batch = await this.db.aiAgentRun.findMany({
        where: {
          workspaceId,
          workflow: 'agent_runtime_localmind_tool_agent',
          status: {
            in: [
              'queued',
              'running',
              'waiting_approval',
              'waiting_for_location',
              'waiting_lease',
            ],
          },
          ...(after ? { id: { gt: after } } : {}),
        },
        include: { steps: true },
        orderBy: { id: 'asc' },
        take: 100,
      });
      runs.push(...batch);
      after = batch.length === 100 ? batch.at(-1)?.id : undefined;
    } while (after);
    return runs;
  }
  state(workspaceId: string) {
    return this.db.workspacePageTreeState.findUnique({
      where: { workspaceId },
    });
  }
  plan(id: string, workspaceId: string) {
    return this.db.workspacePageTreePlan.findUnique({
      where: { id_workspaceId: { id, workspaceId } },
    });
  }
  @Transactional<TransactionalAdapterPrisma>({ timeout: 60000 })
  async lock<T>(workspaceId: string, operation: () => Promise<T>) {
    // Same authority -> organization order used by other resource commands.
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${permissionWorkspaceLockKey(workspaceId)}, 0))`;
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`directory-authorization:${workspaceId}`}, 0))`;
    return operation();
  }
  async savePlan(input: {
    workspaceId: string;
    actorId: string;
    sourceRevision: string;
    fingerprint: string;
    plan: Prisma.InputJsonValue;
  }) {
    await this.db.workspacePageTreePlan.createMany({
      data: [input],
      skipDuplicates: true,
    });
    return this.db.workspacePageTreePlan.findUniqueOrThrow({
      where: {
        workspaceId_fingerprint: {
          workspaceId: input.workspaceId,
          fingerprint: input.fingerprint,
        },
      },
    });
  }
  async freeze(input: {
    workspaceId: string;
    planId: string;
    sourceContract?: string | null;
  }) {
    await this.db.workspacePageTreeState.createMany({
      data: [{ workspaceId: input.workspaceId }],
      skipDuplicates: true,
    });
    const changed = await this.db.workspacePageTreeState.updateMany({
      where: {
        workspaceId: input.workspaceId,
        contractVersion: input.sourceContract ?? null,
        phase: {
          in: input.sourceContract
            ? ['switched']
            : ['preflight', 'needs_resolution', 'retryable_failed'],
        },
        leaseToken: null,
      },
      data: {
        phase: 'frozen',
        planId: input.planId,
        checkpoint: 0,
        attempts: 0,
        errorCode: null,
      },
    });
    if (changed.count !== 1)
      throw new ResourceConflict('Page tree migration is already active');
  }
  async claim(workspaceId: string, planId: string) {
    const token = randomUUID();
    const changed = await this.db.workspacePageTreeState.updateMany({
      where: {
        workspaceId,
        planId,
        OR: [
          { contractVersion: null },
          { contractVersion: WORKSPACE_PAGE_TREE_V1_CONTRACT },
        ],
        attempts: { lt: 8 },
        phase: { in: ['frozen', 'applying', 'validating', 'retryable_failed'] },
        AND: [
          {
            OR: [{ leaseToken: null }, { leaseExpiresAt: { lte: new Date() } }],
          },
        ],
      },
      data: {
        phase: 'applying',
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attempts: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw new ResourceConflict('Page tree migration lease unavailable');
    return token;
  }
  async checkpoint(input: {
    workspaceId: string;
    planId: string;
    token: string;
    expected: number;
    next: number;
    phase: 'applying' | 'validating';
  }) {
    if (input.next < input.expected)
      throw new BadRequest('Invalid migration checkpoint');
    const changed = await this.db.workspacePageTreeState.updateMany({
      where: {
        workspaceId: input.workspaceId,
        planId: input.planId,
        leaseToken: input.token,
        leaseExpiresAt: { gt: new Date() },
        checkpoint: input.expected,
        OR: [
          { contractVersion: null },
          { contractVersion: WORKSPACE_PAGE_TREE_V1_CONTRACT },
        ],
        phase: { in: ['applying', 'validating'] },
      },
      data: {
        checkpoint: input.next,
        phase: input.phase,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    if (changed.count !== 1)
      throw new ResourceConflict('Page tree migration lease expired');
  }
  async switchContract(
    workspaceId: string,
    planId: string,
    token: string,
    contractVersion: string
  ) {
    const changed = await this.db.workspacePageTreeState.updateMany({
      where: {
        workspaceId,
        planId,
        leaseToken: token,
        leaseExpiresAt: { gt: new Date() },
        phase: 'validating',
        OR: [
          { contractVersion: null },
          { contractVersion: WORKSPACE_PAGE_TREE_V1_CONTRACT },
        ],
      },
      data: {
        phase: 'switched',
        contractVersion,
        revision: { increment: 1 },
        leaseToken: null,
        leaseExpiresAt: null,
        errorCode: null,
      },
    });
    if (changed.count !== 1)
      throw new ResourceConflict('Page tree migration cannot switch');
  }
  async fail(
    workspaceId: string,
    planId: string,
    token: string,
    errorCode: string
  ) {
    return this.db.workspacePageTreeState.updateMany({
      where: {
        workspaceId,
        planId,
        leaseToken: token,
        leaseExpiresAt: { gt: new Date() },
        OR: [
          { contractVersion: null },
          { contractVersion: WORKSPACE_PAGE_TREE_V1_CONTRACT },
        ],
      },
      data: {
        phase: 'retryable_failed',
        errorCode,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  }
  async advance(workspaceId: string, expectedRevision: number) {
    const changed = await this.db.workspacePageTreeState.updateMany({
      where: {
        workspaceId,
        phase: 'switched',
        contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        revision: expectedRevision,
      },
      data: { revision: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new ResourceConflict('Page tree changed; reload before retrying');
    return expectedRevision + 1;
  }
  async cancel(workspaceId: string) {
    const result = await this.db.workspacePageTreeState.updateMany({
      where: {
        workspaceId,
        OR: [
          { contractVersion: null },
          { contractVersion: WORKSPACE_PAGE_TREE_V1_CONTRACT },
        ],
        phase: { in: ['frozen', 'applying', 'validating', 'retryable_failed'] },
      },
      data: {
        phase: 'retryable_failed',
        errorCode: 'cancelled',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (result.count !== 1)
      throw new ResourceConflict(
        'A switched tree cannot be cancelled or downgraded'
      );
    return this.state(workspaceId);
  }
  operation(workspaceId: string, actorId: string, requestKey: string) {
    return this.db.workspacePageTreeOperation.findUnique({
      where: {
        workspaceId_actorId_requestKey: { workspaceId, actorId, requestKey },
      },
    });
  }
  receipt(input: Prisma.WorkspacePageTreeOperationUncheckedCreateInput) {
    return this.db.workspacePageTreeOperation.create({ data: input });
  }
  async typedMappings(
    workspaceId: string,
    planId: string,
    rows: {
      sourceKind: string;
      sourceId: string;
      nodeId: string;
      targetKind: string;
      targetId: string;
    }[]
  ) {
    await this.db.workspacePageTreeTypedMapping.createMany({
      data: rows.map(row => ({ ...row, workspaceId, planId })),
      skipDuplicates: true,
    });
    for (const row of rows) {
      const saved =
        await this.db.workspacePageTreeTypedMapping.findUniqueOrThrow({
          where: {
            planId_sourceKind_sourceId: {
              planId,
              sourceKind: row.sourceKind,
              sourceId: row.sourceId,
            },
          },
        });
      if (
        saved.workspaceId !== workspaceId ||
        saved.nodeId !== row.nodeId ||
        saved.targetKind !== row.targetKind ||
        saved.targetId !== row.targetId
      )
        throw new ResourceConflict('Migration identity changed');
    }
  }
  conversion(input: Prisma.WorkspacePageTreeConversionUncheckedCreateInput) {
    return this.db.workspacePageTreeConversion.create({ data: input });
  }
  convertedIdentity(workspaceId: string, sourceKind: string, sourceId: string) {
    return this.db.workspacePageTreeConversion.findFirst({
      where: { workspaceId, sourceKind, sourceId },
      orderBy: { createdAt: 'desc' },
    });
  }
  async mappings(
    workspaceId: string,
    rows: { oldFolderId: string; nodeId: string; documentId: string }[]
  ) {
    await this.db.workspacePageTreeMapping.createMany({
      data: rows.map(row => ({
        oldFolderId: row.oldFolderId,
        nodeId: row.nodeId,
        documentId: row.documentId,
        workspaceId,
      })),
      skipDuplicates: true,
    });
    for (const row of rows) {
      const saved = await this.db.workspacePageTreeMapping.findUniqueOrThrow({
        where: {
          workspaceId_oldFolderId: {
            workspaceId,
            oldFolderId: row.oldFolderId,
          },
        },
      });
      if (saved.nodeId !== row.nodeId || saved.documentId !== row.documentId)
        throw new ResourceConflict('Page tree migration mapping changed');
    }
  }
  /** Complete paginated inventory, including Trash; never infer roots from ACL filtering. */
  async inventory(workspaceId: string) {
    const files = [],
      office = [],
      policies = [];
    let after: string | undefined;
    do {
      const batch = await this.db.workspaceFile.findMany({
        where: { workspaceId, ...(after ? { id: { gt: after } } : {}) },
        include: { state: { include: { revision: true } } },
        orderBy: { id: 'asc' },
        take: 500,
      });
      files.push(...batch);
      after = batch.length === 500 ? batch.at(-1)?.id : undefined;
    } while (after);
    do {
      const batch = await this.db.officeArtifact.findMany({
        where: {
          workspaceId,
          projectId: null,
          ...(after ? { id: { gt: after } } : {}),
        },
        include: { workspaceState: true },
        orderBy: { id: 'asc' },
        take: 500,
      });
      office.push(...batch);
      after = batch.length === 500 ? batch.at(-1)?.id : undefined;
    } while (after);
    let policyCursor: { directoryId: string; principalId: string } | undefined;
    do {
      const batch = await this.db.workspaceDirectoryGrant.findMany({
        where: { workspaceId },
        ...(policyCursor
          ? {
              cursor: {
                workspaceId_directoryId_principalId: {
                  workspaceId,
                  ...policyCursor,
                },
              },
              skip: 1,
            }
          : {}),
        orderBy: [{ directoryId: 'asc' }, { principalId: 'asc' }],
        take: 500,
      });
      policies.push(...batch);
      const last = batch.at(-1);
      policyCursor =
        batch.length === 500 && last
          ? { directoryId: last.directoryId, principalId: last.principalId }
          : undefined;
    } while (policyCursor);
    return { files, office, policies };
  }
}
