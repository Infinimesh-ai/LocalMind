export const RESOURCE_CONTRACT_VERSION = 'localmind-resource-mcp/v1' as const;
export const RESOURCE_CONTENT_LIMIT = 1024 * 1024;
export type ResourceErrorCode =
  | 'invalid_input'
  | 'capability_denied'
  | 'resource_not_found'
  | 'permission_denied'
  | 'version_conflict'
  | 'directory_version_conflict'
  | 'cursor_stale'
  | 'idempotency_conflict'
  | 'external_id_conflict'
  | 'folder_name_conflict'
  | 'unsupported_document_kind'
  | 'unsupported_document_structure'
  | 'content_too_large'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'operation_not_found'
  | 'temporarily_unavailable';

export class ResourceError extends Error {
  constructor(
    readonly code: ResourceErrorCode,
    readonly currentVersion?: string
  ) {
    super(code);
  }
}

export type WorkspaceResourceActor = { workspaceId: string; actorId: string };
export type ResourceContent = { format: 'markdown'; text: string };
export type ResourceWriteCommand =
  | {
      toolName: 'workspace_doc_create';
      title: string;
      content: ResourceContent;
      folderId: string | null;
      externalId?: string;
      idempotencyKey: string;
    }
  | {
      toolName: 'workspace_doc_update';
      documentId: string;
      content: ResourceContent;
      expectedVersion: string;
      idempotencyKey: string;
    }
  | {
      toolName: 'workspace_doc_update_meta';
      documentId: string;
      title: string;
      expectedVersion: string;
      idempotencyKey: string;
    }
  | {
      toolName: 'workspace_folder_create';
      title: string;
      parentId: string | null;
      expectedDirectoryVersion: string;
      idempotencyKey: string;
    }
  | {
      toolName: 'workspace_folder_move_document';
      documentId: string;
      folderId: string | null;
      expectedDirectoryVersion: string;
      idempotencyKey: string;
    };
