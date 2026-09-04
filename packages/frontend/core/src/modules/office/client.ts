import type { GraphQLService } from '@affine/core/modules/cloud';
import type { Workspace } from '@affine/core/modules/workspace';
import {
  executeOfficeCommandMutation,
  importOfficeArtifactMutation,
  previewOfficeCommandQuery,
} from '@affine/graphql';
import { sha } from '@blocksuite/global/utils';
import type { OfficeCommand } from '@localmind/office';

import {
  isDocxSemanticState,
  isNativeOfficeState,
  type OfficeArtifactKindValue,
  type OfficeDocxCommand,
} from './types';

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const PDF_MIME = 'application/pdf';

export const NATIVE_OFFICE_FORMATS = {
  docx: {
    extension: '.docx',
    mimeType: DOCX_MIME,
    kind: 'document',
    fallbackTitle: 'Untitled document',
  },
  xlsx: {
    extension: '.xlsx',
    mimeType: XLSX_MIME,
    kind: 'workbook',
    fallbackTitle: 'Untitled workbook',
  },
  pptx: {
    extension: '.pptx',
    mimeType: PPTX_MIME,
    kind: 'presentation',
    fallbackTitle: 'Untitled presentation',
  },
  pdf: {
    extension: '.pdf',
    mimeType: PDF_MIME,
    kind: 'pdf',
    fallbackTitle: 'Untitled PDF',
  },
} as const;

export type NativeOfficeFileFormat = keyof typeof NATIVE_OFFICE_FORMATS;

export function officeFormatForFileName(fileName: string) {
  const normalized = fileName.toLowerCase();
  const format = (
    Object.keys(NATIVE_OFFICE_FORMATS) as NativeOfficeFileFormat[]
  ).find(candidate =>
    normalized.endsWith(NATIVE_OFFICE_FORMATS[candidate].extension)
  );
  if (!format) {
    throw new Error('Native Office requires a DOCX, XLSX, PPTX, or PDF file');
  }
  return { format, ...NATIVE_OFFICE_FORMATS[format] };
}

export async function fetchOfficeState(
  url: string,
  kind?: OfficeArtifactKindValue,
  signal?: AbortSignal
) {
  const response = await fetch(url, {
    credentials: 'include',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to load Office state (${response.status})`);
  }
  const value: unknown = await response.json();
  if (!isNativeOfficeState(value, kind)) {
    throw new Error('The server returned an unsupported Office state');
  }
  return value;
}

export async function fetchOfficeDocxState(url: string, signal?: AbortSignal) {
  const value = await fetchOfficeState(url, 'document', signal);
  if (!isDocxSemanticState(value)) {
    throw new Error('The server returned an unsupported DOCX state');
  }
  return value;
}

export async function previewOfficeCommand(
  graphql: GraphQLService,
  workspaceId: string,
  command: OfficeCommand
) {
  return await graphql.gql({
    query: previewOfficeCommandQuery,
    variables: { input: { workspaceId, command } },
  });
}

export async function executeOfficeCommand(
  graphql: GraphQLService,
  workspaceId: string,
  command: OfficeCommand
) {
  return await graphql.gql({
    query: executeOfficeCommandMutation,
    variables: { input: { workspaceId, command } },
  });
}

export async function previewOfficeDocxCommand(
  graphql: GraphQLService,
  workspaceId: string,
  command: OfficeDocxCommand
) {
  const result = await previewOfficeCommand(graphql, workspaceId, command);
  return { previewOfficeDocxCommand: result.previewOfficeCommand };
}

export async function executeOfficeDocxCommand(
  graphql: GraphQLService,
  workspaceId: string,
  command: OfficeDocxCommand
) {
  const result = await executeOfficeCommand(graphql, workspaceId, command);
  return { executeOfficeDocxCommand: result.executeOfficeCommand };
}

export async function importNativeOffice(
  workspace: Workspace,
  graphql: GraphQLService,
  file: File
) {
  const policy = officeFormatForFileName(file.name);
  const data = new Uint8Array(await file.arrayBuffer());
  const key = await sha(data.buffer);
  await workspace.engine.blob.set({ key, data, mime: policy.mimeType });
  await workspace.engine.blob.upload(key);
  const title =
    file.name.slice(0, -policy.extension.length).trim() || policy.fallbackTitle;
  const result = await graphql.gql({
    query: importOfficeArtifactMutation,
    variables: {
      input: {
        workspaceId: workspace.id,
        sourceBlobKey: key,
        title,
        sourceFileName: file.name,
        idempotencyKey: `office-${policy.format}-import:${key}`,
      },
    },
  });
  return result.importOfficeArtifact;
}

export async function importNativeDocx(
  workspace: Workspace,
  graphql: GraphQLService,
  file: File
) {
  const policy = officeFormatForFileName(file.name);
  if (policy.format !== 'docx') {
    throw new Error('Native DOCX import requires a .docx file');
  }
  return await importNativeOffice(workspace, graphql, file);
}

export async function downloadOfficePackage(url: string, filename: string) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to download document (${response.status})`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function officePackagePartUrl(packageUrl: string, partName: string) {
  const url = new URL(packageUrl, window.location.href);
  if (!url.pathname.endsWith('/package')) {
    throw new Error('Invalid Office package URL');
  }
  url.pathname = `${url.pathname.slice(0, -'/package'.length)}/part`;
  url.search = '';
  url.searchParams.set('path', partName);
  return url.toString();
}

export function officePdfExportUrl(packageUrl: string) {
  const url = new URL(packageUrl, window.location.href);
  if (!url.pathname.endsWith('/package')) {
    throw new Error('Invalid Office package URL');
  }
  url.pathname = `${url.pathname.slice(0, -'/package'.length)}/export/pdf`;
  url.search = '';
  return url.toString();
}
