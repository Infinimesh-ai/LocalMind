export type ProjectFileTextDraft = {
  version: number;
  text: string;
  savedText: string;
  pending: {
    requestKey: string;
    expectedContentVersion: number;
    text: string;
  } | null;
};

// Session storage is scoped to the browser tab. Include the authenticated
// account and resource identities so a different account never sees a draft.
export function projectFileDraftKey(
  server: string,
  accountId: string,
  projectId: string,
  resourceId: string
) {
  return `localmind-project-file-draft:${JSON.stringify([server, accountId, projectId, resourceId])}`;
}

export function readProjectFileDraft(key: string): ProjectFileTextDraft | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  const draft: unknown = JSON.parse(raw);
  if (!draft || typeof draft !== 'object') throw new Error('Invalid draft');
  const value = draft as Record<string, unknown>;
  if (
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    typeof value.text !== 'string' ||
    typeof value.savedText !== 'string'
  )
    throw new Error('Invalid draft');
  if (value.pending !== null) {
    if (!value.pending || typeof value.pending !== 'object')
      throw new Error('Invalid draft');
    const pending = value.pending as Record<string, unknown>;
    if (
      typeof pending.requestKey !== 'string' ||
      !pending.requestKey ||
      !Number.isSafeInteger(pending.expectedContentVersion) ||
      (pending.expectedContentVersion as number) < 1 ||
      typeof pending.text !== 'string'
    )
      throw new Error('Invalid draft');
  }
  return draft as ProjectFileTextDraft;
}

export function writeProjectFileDraft(
  key: string,
  draft: ProjectFileTextDraft
) {
  sessionStorage.setItem(key, JSON.stringify(draft));
}

export function clearProjectFileDraft(key: string) {
  sessionStorage.removeItem(key);
}
