import type { GraphQLService } from '@affine/core/modules/cloud';
import {
  downloadOfficePackage,
  fetchOfficeState,
  type NativeOfficeState,
  officePdfExportUrl,
  type OfficeResourceOwner,
} from '@affine/core/modules/office';
import {
  officeArtifactQuery,
  type OfficeRevisionCompareQuery,
  officeRevisionCompareQuery,
  officeRevisionsQuery,
  projectOfficeArtifactQuery,
  type ProjectOfficeRevisionCompareQuery,
  projectOfficeRevisionCompareQuery,
  projectOfficeRevisionsQuery,
} from '@affine/graphql';
import { I18n } from '@affine/i18n';

import type { OfficeArtifact, OfficeRevision } from './shared';

export type OfficeResourceDescriptor = OfficeArtifact;
export type OfficeRevisionCompare =
  | OfficeRevisionCompareQuery['officeRevisionCompare']
  | ProjectOfficeRevisionCompareQuery['projectOfficeRevisionCompare'];
export type OfficeSurfaceCapabilities = {
  canEdit: boolean;
  canDownload: boolean;
  canPrint: boolean;
  canExportPdf: boolean;
  canViewHistory: boolean;
  canComment: boolean;
  canUseAI: boolean;
  canPublish?: boolean;
  readOnlyReason?: string;
};
export interface OfficeResourceAdapter {
  readonly owner: OfficeResourceOwner;
  readonly artifactId: string;
  loadArtifact(): Promise<OfficeResourceDescriptor | null>;
  loadState(
    revision: OfficeRevision,
    kind: OfficeArtifact['kind'],
    signal?: AbortSignal
  ): Promise<NativeOfficeState>;
  listRevisions(limit: number): Promise<OfficeRevision[]>;
  compareRevisions(
    beforeId: string,
    afterId: string
  ): Promise<OfficeRevisionCompare>;
  download(
    artifact: OfficeResourceDescriptor,
    revision: OfficeRevision
  ): Promise<void>;
  exportPdf(
    artifact: OfficeResourceDescriptor,
    revision: OfficeRevision
  ): Promise<void>;
}

export function revisionBelongsTo(
  adapter: Pick<OfficeResourceAdapter, 'owner' | 'artifactId'>,
  revision: OfficeRevision
) {
  return (
    revision.artifactId === adapter.artifactId &&
    (adapter.owner.kind === 'project'
      ? 'projectId' in revision &&
        revision.projectId === adapter.owner.projectId
      : 'workspaceId' in revision &&
        revision.workspaceId === adapter.owner.workspaceId)
  );
}

export function createOfficeResourceAdapter(
  graphql: GraphQLService,
  owner: OfficeResourceOwner,
  artifactId: string
): OfficeResourceAdapter {
  return {
    owner,
    artifactId,
    async loadArtifact() {
      if (owner.kind === 'project')
        return (
          await graphql.gql({
            query: projectOfficeArtifactQuery,
            variables: { projectId: owner.projectId, artifactId },
          })
        ).projectOfficeArtifact;
      return (
        await graphql.gql({
          query: officeArtifactQuery,
          variables: { workspaceId: owner.workspaceId, artifactId },
        })
      ).officeArtifact;
    },
    async loadState(revision, kind, signal) {
      if (!revisionBelongsTo({ owner, artifactId }, revision))
        throw new Error(
          I18n[
            'com.affine.office.office-task-result-targets-a-different-artifact'
          ]()
        );
      if (!revision.stateUrl)
        throw new Error(
          I18n[
            'com.affine.office.this-document-revision-has-no-editable-state'
          ]()
        );
      return fetchOfficeState(revision.stateUrl, kind, signal);
    },
    async listRevisions(limit) {
      if (owner.kind === 'project')
        return (
          await graphql.gql({
            query: projectOfficeRevisionsQuery,
            variables: { projectId: owner.projectId, artifactId, limit },
          })
        ).projectOfficeRevisions;
      return (
        await graphql.gql({
          query: officeRevisionsQuery,
          variables: { workspaceId: owner.workspaceId, artifactId, limit },
        })
      ).officeRevisions;
    },
    async compareRevisions(beforeRevisionId, afterRevisionId) {
      const variables = { artifactId, beforeRevisionId, afterRevisionId };
      if (owner.kind === 'project')
        return (
          await graphql.gql({
            query: projectOfficeRevisionCompareQuery,
            variables: { ...variables, projectId: owner.projectId },
          })
        ).projectOfficeRevisionCompare;
      return (
        await graphql.gql({
          query: officeRevisionCompareQuery,
          variables: { ...variables, workspaceId: owner.workspaceId },
        })
      ).officeRevisionCompare;
    },
    download: (artifact, revision) =>
      downloadOfficePackage(revision.packageUrl, artifact.sourceFileName),
    exportPdf: (artifact, revision) =>
      downloadOfficePackage(
        officePdfExportUrl(revision.packageUrl),
        `${artifact.title || 'document'}.pdf`
      ),
  };
}

export type OfficeTaskRevisionEvidence = {
  taskId: string;
  artifactId: string;
  revisionId: string;
  sequence: number | null;
};

/** Verify durable evidence in the same owner before refreshing either surface. */
export async function verifyOfficeTaskRevision(
  adapter: OfficeResourceAdapter,
  evidence: OfficeTaskRevisionEvidence,
  currentSequence = 0
) {
  if (evidence.artifactId !== adapter.artifactId)
    throw new Error(
      I18n[
        'com.affine.office.office-task-result-targets-a-different-artifact'
      ]()
    );
  const artifact = await adapter.loadArtifact();
  if (
    !artifact ||
    artifact.id !== adapter.artifactId ||
    !revisionBelongsTo(adapter, artifact.currentRevision)
  )
    throw new Error(
      I18n[
        'com.affine.office.the-completed-office-task-artifact-is-unavailable'
      ]()
    );
  const latest = artifact.currentRevision;
  const revision =
    latest.id === evidence.revisionId
      ? latest
      : (await adapter.listRevisions(100)).find(
          item => item.id === evidence.revisionId
        );
  if (
    !revision ||
    !revisionBelongsTo(adapter, revision) ||
    revision.origin !== 'ai'
  )
    throw new Error(
      I18n[
        'com.affine.office.office-task-revision-evidence-could-not-be-verified'
      ]()
    );
  if (evidence.sequence !== null && revision.sequence !== evidence.sequence)
    throw new Error(
      I18n[
        'com.affine.office.office-task-revision-sequence-evidence-does-not-match'
      ]()
    );
  if (latest.sequence < Math.max(revision.sequence, currentSequence))
    throw new Error(
      I18n[
        'com.affine.office.the-latest-office-revision-is-behind-task-evidence'
      ]()
    );
  return artifact;
}
