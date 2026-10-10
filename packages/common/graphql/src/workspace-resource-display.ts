/** Changing this order requires a new sort version (and new pagination cursors). */
export const WORKSPACE_RESOURCE_SORT_VERSION = 1;
export const workspaceDocumentTypes = [
  'page',
  'edgeless',
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'txt',
  'markdown',
  'csv',
  'json',
  'image',
  'audio',
  'video',
  'other',
  'folder',
] as const;
export type WorkspaceDocumentType = (typeof workspaceDocumentTypes)[number];
export type ResourceSortField =
  | 'title'
  | 'createdAt'
  | 'updatedAt'
  | 'documentType';
export type ResourceDisplayProperties = {
  tags: boolean;
  created: boolean;
  updated: boolean;
  documentType: boolean;
};

/** MIME comes from the effective revision. A rename cannot change resource type. */
export function workspaceDocumentType(input: {
  kind: 'doc' | 'file' | 'office' | 'folder';
  primaryMode?: string;
  officeKind?: string | null;
  mimeType?: string;
}): WorkspaceDocumentType {
  if (input.kind === 'folder') return 'folder';
  if (input.kind === 'doc')
    return input.primaryMode === 'edgeless' ? 'edgeless' : 'page';
  if (input.kind === 'office') {
    switch (input.officeKind) {
      case 'document':
        return 'docx';
      case 'workbook':
        return 'xlsx';
      case 'presentation':
        return 'pptx';
      case 'pdf':
        return 'pdf';
      default:
        return 'other';
    }
  }
  const mime = input.mimeType?.split(';')[0].trim().toLowerCase() ?? '';
  switch (mime) {
    case 'text/plain':
      return 'txt';
    case 'text/markdown':
    case 'text/x-markdown':
      return 'markdown';
    case 'text/csv':
    case 'application/csv':
      return 'csv';
    case 'application/json':
    case 'text/json':
      return 'json';
  }
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}

export interface WorkspaceResourceSortValue {
  identity: string;
  title: string;
  documentType: WorkspaceDocumentType;
  createdAt: number | null;
  updatedAt: number | null;
}
export const workspaceResourceIdentity = (
  workspaceId: string,
  kind: string,
  id: string
) => JSON.stringify([workspaceId, kind, id]);
const collator = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
});
export function compareWorkspaceResources(
  a: WorkspaceResourceSortValue,
  b: WorkspaceResourceSortValue,
  field: ResourceSortField,
  desc: boolean
) {
  let result: number;
  switch (field) {
    case 'title':
      result = collator.compare(
        a.title.normalize('NFC'),
        b.title.normalize('NFC')
      );
      break;
    case 'documentType': {
      if ((a.documentType === 'other') !== (b.documentType === 'other'))
        return a.documentType === 'other' ? 1 : -1;
      result =
        workspaceDocumentTypes.indexOf(a.documentType) -
        workspaceDocumentTypes.indexOf(b.documentType);
      break;
    }
    case 'createdAt':
    case 'updatedAt': {
      const x = a[field],
        y = b[field];
      if ((x === null) !== (y === null)) return x === null ? 1 : -1;
      result = x === null || y === null ? 0 : x - y;
      break;
    }
    default:
      throw new Error(`Unsupported resource sort field: ${field}`);
  }
  return (
    result * (desc ? -1 : 1) ||
    (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0)
  );
}

export function resourceDate(
  value: string | number | null | undefined
): number | null {
  const time =
    typeof value === 'number' ? value : value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && Number.isFinite(new Date(time).getTime())
    ? time
    : null;
}
export function resourceDay(value: number | null): string {
  if (value === null) return '';
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface ResourceUpdateEvent {
  at: number;
  actor: 'user' | 'system' | 'unknown';
  by: string | null;
}
/** A single CRDT register keeps actor and timestamp together during offline merges. */
export function readResourceUpdateEvent(
  value: unknown
): ResourceUpdateEvent | null {
  if (typeof value !== 'string') return null;
  try {
    const event = JSON.parse(value) as Partial<ResourceUpdateEvent>;
    if (
      typeof event.at !== 'number' ||
      resourceDate(event.at) === null ||
      !['user', 'system', 'unknown'].includes(event.actor ?? '') ||
      (event.actor === 'user'
        ? typeof event.by !== 'string' || !event.by
        : event.by !== null)
    )
      return null;
    return event as ResourceUpdateEvent;
  } catch {
    return null;
  }
}
