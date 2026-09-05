import { Injectable } from '@nestjs/common';

import { PermissionService } from '../../core/permission';
import { type CopilotContextDocumentRef, Models } from '../../models';

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
  readableDocumentRefs: CopilotContextDocumentRef[];
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
    ).map(docId => ({ workspaceId: input.workspaceId, docId }));
    const readableHostDocuments = await this.filterReadableDocumentRefs(
      input.userId,
      candidateDocs
    );
    const readableDocIds = readableHostDocuments.map(doc => doc.docId);
    const memberships =
      await this.models.copilotContextMemory.listProjectMembershipsForDocs({
        userId: input.userId,
        workspaceId: input.workspaceId,
        docIds: readableDocIds,
      });
    const inferredProjectIds = Array.from(
      new Set(memberships.map(membership => membership.projectId))
    );
    const automaticResolution = this.resolveProjectStatus(
      readableHostDocuments,
      memberships
    );
    let selectedProjectId: string | null = null;
    let selectedProjectDocuments: CopilotContextDocumentRef[] = [];
    let selectedProjectScopeAuthorized = false;
    if (input.selectedProjectId) {
      const project = await this.models.copilotContextMemory.getProject(
        input.selectedProjectId
      );
      const isActiveMember =
        project?.status === 'active' &&
        project.members.some(member => member.userId === input.userId);
      if (isActiveMember) {
        const projectDocuments = this.uniqueDocumentRefs(
          await this.models.intelligenceWorkbenchAuthorization.listGrantedProjectDocuments(
            { projectId: project.id, userId: input.userId }
          )
        );
        selectedProjectDocuments = await this.filterReadableDocumentRefs(
          input.userId,
          projectDocuments
        );
        selectedProjectId = project.id;
        selectedProjectScopeAuthorized =
          selectedProjectDocuments.length === projectDocuments.length;
      }
    }
    let inferredProjectScopeAuthorized = false;
    if (!input.selectedProjectId && automaticResolution === 'single') {
      const inferredProjectId = inferredProjectIds[0];
      const project = inferredProjectId
        ? await this.models.copilotContextMemory.getProject(inferredProjectId)
        : null;
      const isActiveMember =
        project?.status === 'active' &&
        project.members.some(member => member.userId === input.userId);
      if (isActiveMember) {
        const projectDocuments = this.uniqueDocumentRefs(
          await this.models.intelligenceWorkbenchAuthorization.listGrantedProjectDocuments(
            { projectId: project.id, userId: input.userId }
          )
        );
        const readableProjectDocuments = await this.filterReadableDocumentRefs(
          input.userId,
          projectDocuments
        );
        inferredProjectScopeAuthorized =
          readableProjectDocuments.length === projectDocuments.length;
      }
    }
    const candidateProjectIds = Array.from(
      new Set([
        ...inferredProjectIds,
        ...(selectedProjectId ? [selectedProjectId] : []),
      ])
    );
    const projectResolution = selectedProjectId
      ? ('selected' as const)
      : input.selectedProjectId
        ? ('invalid_selection' as const)
        : automaticResolution;

    const readableDocumentRefs = this.uniqueDocumentRefs([
      ...readableHostDocuments,
      ...selectedProjectDocuments,
    ]);

    return {
      userId: input.userId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      primaryDocId:
        input.primaryDocId && readableDocIds.includes(input.primaryDocId)
          ? input.primaryDocId
          : null,
      readableDocIds,
      readableDocumentRefs,
      candidateProjectIds,
      projectIds:
        projectResolution === 'selected' && selectedProjectScopeAuthorized
          ? [selectedProjectId as string]
          : projectResolution === 'single' && inferredProjectScopeAuthorized
            ? candidateProjectIds
            : [],
      selectedProjectId,
      projectResolution,
    };
  }

  private resolveProjectStatus(
    readableDocuments: CopilotContextDocumentRef[],
    memberships: Array<{
      workspaceId: string;
      docId: string;
      projectId: string;
    }>
  ): ContextProjectResolution {
    if (!readableDocuments.length || !memberships.length) return 'none';
    const projectIds = new Set(
      memberships.map(membership => membership.projectId)
    );
    if (projectIds.size > 1) return 'ambiguous';

    const coveredDocuments = new Set(
      memberships.map(membership =>
        this.documentRefKey(membership.workspaceId, membership.docId)
      )
    );
    if (
      readableDocuments.some(
        document =>
          !coveredDocuments.has(
            this.documentRefKey(document.workspaceId, document.docId)
          )
      )
    ) {
      return 'mixed';
    }
    return 'single';
  }

  private async filterReadableDocumentRefs(
    userId: string,
    documents: CopilotContextDocumentRef[]
  ) {
    const uniqueDocuments = this.uniqueDocumentRefs(documents);
    const documentsByWorkspace = new Map<string, CopilotContextDocumentRef[]>();
    for (const document of uniqueDocuments) {
      const current = documentsByWorkspace.get(document.workspaceId) ?? [];
      current.push(document);
      documentsByWorkspace.set(document.workspaceId, current);
    }
    const readableKeys = new Set<string>();
    await Promise.all(
      [...documentsByWorkspace].map(
        async ([workspaceId, workspaceDocuments]) => {
          const readable = await this.permission.filterReadableDocs({
            userId,
            workspaceId,
            docs: workspaceDocuments.map(document => ({
              docId: document.docId,
            })),
            allowLocal: true,
          });
          for (const document of readable) {
            readableKeys.add(this.documentRefKey(workspaceId, document.docId));
          }
        }
      )
    );
    return uniqueDocuments.filter(document =>
      readableKeys.has(
        this.documentRefKey(document.workspaceId, document.docId)
      )
    );
  }

  private uniqueDocumentRefs(documents: CopilotContextDocumentRef[]) {
    const unique = new Map<string, CopilotContextDocumentRef>();
    for (const document of documents) {
      if (!document.workspaceId || !document.docId) continue;
      unique.set(this.documentRefKey(document.workspaceId, document.docId), {
        workspaceId: document.workspaceId,
        docId: document.docId,
      });
    }
    return [...unique.values()];
  }

  private documentRefKey(workspaceId: string, docId: string) {
    return `${workspaceId}\u0000${docId}`;
  }
}
