import { Injectable } from '@nestjs/common';

import { PermissionService } from '../../core/permission';
import { Models } from '../../models';

export type ContextProjectResolution =
  | 'none'
  | 'single'
  | 'mixed'
  | 'ambiguous'
  | 'selected'
  | 'invalid_selection';

export type ContextScopeResolution = {
  userId: string;
  workspaceId: string;
  sessionId: string;
  primaryDocId: string | null;
  readableDocIds: string[];
  candidateProjectIds: string[];
  projectIds: string[];
  selectedProjectId: string | null;
  projectResolution: ContextProjectResolution;
};

@Injectable()
export class ContextScopeResolver {
  constructor(
    private readonly models: Models,
    private readonly permission: PermissionService
  ) {}

  async resolve(input: {
    userId: string;
    workspaceId: string;
    sessionId: string;
    primaryDocId?: string | null;
    selectedProjectId?: string | null;
  }): Promise<ContextScopeResolution> {
    const attachedDocIds = await this.models.copilotContext.listSessionDocIds(
      input.sessionId
    );
    const candidateDocs = Array.from(
      new Set(
        [input.primaryDocId, ...attachedDocIds].filter(
          (docId): docId is string => Boolean(docId)
        )
      )
    ).map(docId => ({ docId }));
    const readableDocs = candidateDocs.length
      ? await this.permission.filterReadableDocs({
          userId: input.userId,
          workspaceId: input.workspaceId,
          docs: candidateDocs,
          allowLocal: true,
        })
      : [];
    const readableDocIds = readableDocs.map(doc => doc.docId);
    const memberships =
      await this.models.copilotContextMemory.listProjectMembershipsForDocs({
        workspaceId: input.workspaceId,
        docIds: readableDocIds,
      });
    const candidateProjectIds = Array.from(
      new Set(memberships.map(membership => membership.projectId))
    );
    const automaticResolution = this.resolveProjectStatus(
      readableDocIds,
      memberships
    );
    const selectedProjectId =
      input.selectedProjectId &&
      candidateProjectIds.includes(input.selectedProjectId)
        ? input.selectedProjectId
        : null;
    const projectResolution = selectedProjectId
      ? ('selected' as const)
      : input.selectedProjectId
        ? ('invalid_selection' as const)
        : automaticResolution;

    return {
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      primaryDocId:
        input.primaryDocId && readableDocIds.includes(input.primaryDocId)
          ? input.primaryDocId
          : null,
      readableDocIds,
      candidateProjectIds,
      projectIds:
        projectResolution === 'selected'
          ? [selectedProjectId as string]
          : projectResolution === 'single'
            ? candidateProjectIds
            : [],
      selectedProjectId,
      projectResolution,
    };
  }

  private resolveProjectStatus(
    readableDocIds: string[],
    memberships: Array<{ docId: string; projectId: string }>
  ): ContextProjectResolution {
    if (!readableDocIds.length || !memberships.length) return 'none';
    const projectIds = new Set(
      memberships.map(membership => membership.projectId)
    );
    if (projectIds.size > 1) return 'ambiguous';

    const coveredDocIds = new Set(
      memberships.map(membership => membership.docId)
    );
    if (readableDocIds.some(docId => !coveredDocIds.has(docId))) {
      return 'mixed';
    }
    return 'single';
  }
}
