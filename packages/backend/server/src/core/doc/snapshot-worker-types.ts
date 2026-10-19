export type SnapshotView = {
  maps: Record<string, Record<string, unknown>>;
  pagesKind: 'absent' | 'array' | 'invalid';
  legacyPagePropertiesIsMap: boolean;
};

export type SnapshotTask =
  | { kind: 'decode'; bin: Uint8Array | null }
  | { kind: 'pageContent'; bin: Uint8Array; maxSummaryLength: number }
  | { kind: 'workspaceContent'; bin: Uint8Array }
  | { kind: 'docIds'; bin: Uint8Array; includeTrash: boolean }
  | {
      kind: 'validate';
      workspaceId: string;
      docId: string;
      updates: Uint8Array[];
      snapshots: Record<string, Uint8Array | null>;
    };

export type SnapshotResult =
  | SnapshotView
  | import('../utils/blocksuite').PageDocContent
  | import('../utils/blocksuite').WorkspaceDocContent
  | string[]
  | null;
