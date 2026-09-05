import type { WorkspaceMetadata } from './metadata';

export interface WorkspaceOpenOptions {
  metadata: WorkspaceMetadata;
  isSharedMode?: boolean;
  /** Restricts this transient workspace to one server-authorized document. */
  docScopeId?: string;
  /** Client-side UX cap. The server remains authoritative for every action. */
  docScopeAccess?: 'read' | 'write';
}
