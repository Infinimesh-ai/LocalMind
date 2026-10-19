import type { FetchService, GraphQLService } from '@affine/core/modules/cloud';
import {
  acquireProjectResourceEditLeaseMutation,
  projectOfficeArtifactQuery,
  projectReportCommandMutation,
  projectReportStateQuery,
  projectResourceQuery,
  releaseProjectResourceEditLeaseMutation,
} from '@affine/graphql';
import {
  ReportDocumentSchema,
  ReportProjectionSchema,
  ReportTemplateSchema,
} from '@localmind/office/report';
import { z } from 'zod';

import type {
  ProjectReportApi,
  ReportCommandResult,
  ReportQuery,
  ReportState,
} from './contracts';

function readState(
  value: unknown,
  query: Pick<ReportQuery, 'projectId' | 'reportId' | 'view' | 'scheduleId'>
): ReportState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid report response');
  const state = value as ReportState;
  if (query.scheduleId && state.scheduleId !== query.scheduleId)
    throw new Error('Report schedule response belongs to another schedule');
  if (query.view === 'schedule_revisions') {
    state.scheduleRevisions =
      state.revisions as unknown as ReportState['scheduleRevisions'];
    delete state.revisions;
    state.nextCursors = { scheduleRevisions: state.nextCursors?.revisions };
  }
  if (
    state.report &&
    (state.report.projectId !== query.projectId ||
      (query.reportId && state.report.id !== query.reportId))
  )
    throw new Error('Report response belongs to another project');
  if (state.reports?.items.some(report => report.projectId !== query.projectId))
    throw new Error('Report list belongs to another project');
  if (state.projection)
    state.projection = ReportProjectionSchema.parse(state.projection);
  if (state.document)
    state.document = ReportDocumentSchema.parse(state.document);
  for (const template of state.templates ?? [])
    template.current.content = ReportTemplateSchema.parse(
      template.current.content
    );
  for (const candidate of state.candidates ?? [])
    candidate.document = ReportDocumentSchema.parse(candidate.document);
  return state;
}

export function reportAssetUrl(path: string, baseUrl: string) {
  const url = new URL(path, baseUrl);
  if (
    url.origin !== new URL(baseUrl).origin ||
    !/^\/api\/(?:projects\/[^/]+\/reports\/|report-shares\/)/.test(
      url.pathname
    ) ||
    path.includes('\\')
  )
    throw new Error('Invalid report asset path');
  return url.toString();
}

const SharedReportResponseSchema = z.object({
  projection: ReportProjectionSchema,
  assetUrls: z.record(z.string()).default({}),
  downloads: z
    .record(z.enum(['pdf', 'pptx', 'offline']), z.string())
    .default({}),
});
export function readSharedReport(value: unknown, baseUrl: string) {
  const result = SharedReportResponseSchema.parse(value);
  return {
    ...result,
    assetUrls: Object.fromEntries(
      Object.entries(result.assetUrls).map(([id, path]) => [
        id,
        reportAssetUrl(path, baseUrl),
      ])
    ),
    downloads: Object.fromEntries(
      Object.entries(result.downloads).map(([format, path]) => [
        format,
        reportAssetUrl(path, baseUrl),
      ])
    ),
  };
}

/** Uses the same server and account scope as the surrounding Project. */
export function createProjectReportApi(
  graphql: Pick<GraphQLService, 'gql'>,
  fetcher: Pick<FetchService, 'fetch'>,
  baseUrl: string = window.location.origin
): ProjectReportApi {
  const attempts = new Map<
    string,
    { requestKey: string; pending?: Promise<ReportCommandResult> }
  >();
  const normalize = (state: ReportState) => {
    if (state.assetUrls)
      state.assetUrls = Object.fromEntries(
        Object.entries(state.assetUrls).map(([id, path]) => [
          id,
          reportAssetUrl(path, baseUrl),
        ])
      );
    return state;
  };
  const api: ProjectReportApi = {
    async query(input, signal) {
      const result = await graphql.gql({
        query: projectReportStateQuery,
        variables: input,
        context: { signal },
      });
      return normalize(readState(result.projectReportState, input));
    },
    async command(input) {
      const { requestKey, ...payload } = input;
      const fingerprint = JSON.stringify(payload);
      const previous = attempts.get(fingerprint);
      if (previous?.pending) return previous.pending;
      const attempt = {
        requestKey: previous?.requestKey ?? requestKey,
        pending: undefined as Promise<ReportCommandResult> | undefined,
      };
      const promise = graphql
        .gql({
          query: projectReportCommandMutation,
          variables: { input: { ...payload, requestKey: attempt.requestKey } },
        })
        .then(result => {
          const parsed = normalize(
            readState(result.projectReportCommand, input)
          ) as ReportCommandResult;
          attempts.delete(fingerprint);
          return parsed;
        })
        .catch(error => {
          attempt.pending = undefined;
          throw error;
        });
      attempt.pending = promise;
      attempts.set(fingerprint, attempt);
      if (attempts.size > 128) {
        const first = attempts.keys().next().value;
        if (first) attempts.delete(first);
      }
      return promise;
    },
    async updateExportResource(input, resourceId) {
      if (input.command.operation !== 'export.save')
        throw new Error('Invalid export save command');
      const tabId = crypto.randomUUID();
      const leaseInput = { projectId: input.projectId, resourceId, tabId };
      const acquired = await graphql.gql({
        query: acquireProjectResourceEditLeaseMutation,
        variables: { input: leaseInput },
      });
      const proof = acquired.acquireProjectResourceEditLease.lease;
      if (
        !acquired.acquireProjectResourceEditLease.acquired ||
        !proof?.owned ||
        !proof.leaseId
      )
        throw new Error('The target resource is being edited');
      const leaseId = proof.leaseId;
      try {
        const { projectResource: resource } = await graphql.gql({
          query: projectResourceQuery,
          variables: { projectId: input.projectId, resourceId },
        });
        if (!resource || resource.trashedAt)
          throw new Error('Target resource unavailable');
        const artifact = resource.officeArtifactId
          ? await graphql.gql({
              query: projectOfficeArtifactQuery,
              variables: {
                projectId: input.projectId,
                artifactId: resource.officeArtifactId,
              },
            })
          : undefined;
        return await api.command({
          ...input,
          command: {
            ...input.command,
            resourceId,
            expectedResourceVersion: resource.version,
            expectedParentRevisionId:
              artifact?.projectOfficeArtifact.currentRevision?.id,
            resourceEditLease: { tabId, leaseId },
          },
        });
      } finally {
        await graphql.gql({
          query: releaseProjectResourceEditLeaseMutation,
          variables: { input: { ...leaseInput, leaseId } },
        });
      }
    },
    async download(url, filename) {
      // Download endpoints remain revocable; never navigate a model-provided URL.
      if (
        !/^\/api\/(?:projects\/[^/]+\/reports\/|report-shares\/)/.test(url) ||
        url.includes('\\')
      )
        throw new Error('Invalid report download path');
      const response = await fetcher.fetch(url, { credentials: 'include' });
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    },
  };
  return api;
}
