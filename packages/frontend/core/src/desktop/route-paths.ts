export const WORKSPACE_ROUTE_PATH = '/workspace/:workspaceId/*';
export const SHARE_ROUTE_PATH = '/share/:workspaceId/:pageId';
export const NOT_FOUND_ROUTE_PATH = '/404';
export const CATCH_ALL_ROUTE_PATH = '*';
export const PROJECT_ROUTE_PATH = '/project';
export const PROJECT_NEW_CONVERSATION_PATH = `${PROJECT_ROUTE_PATH}/conversations/new`;

export const getProjectPath = (
  projectId?: string | null,
  resourceId?: string | null
) => {
  if (!projectId) return PROJECT_ROUTE_PATH;
  const projectPath = `${PROJECT_ROUTE_PATH}/${encodeURIComponent(projectId)}`;
  return resourceId
    ? `${projectPath}/resources/${encodeURIComponent(resourceId)}`
    : projectPath;
};

export const getProjectDocumentsPath = (
  projectId?: string | null,
  resourceId?: string | null
) => `${getProjectPath(projectId, resourceId)}?view=files`;

export const getProjectConversationPath = (
  projectId: string,
  sessionId: string,
  workOrderId?: string
) =>
  `${PROJECT_ROUTE_PATH}/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(sessionId)}${workOrderId ? `?${new URLSearchParams({ workOrderId })}` : ''}`;

export const getWorkOrderPath = (workOrderId: string) =>
  `${PROJECT_ROUTE_PATH}/work-orders/${encodeURIComponent(workOrderId)}`;

export const getProjectReportPath = (
  projectId: string,
  reportId?: string,
  revisionId?: string
) => {
  const root = `${getProjectPath(projectId)}/reports`;
  if (!reportId) return root;
  const report = `${root}/${encodeURIComponent(reportId)}`;
  return revisionId
    ? `${report}/revisions/${encodeURIComponent(revisionId)}`
    : report;
};

export const getProjectReportPresentationPath = (
  projectId: string,
  reportId: string,
  view: 'present' | 'presenter',
  snapshot: { revisionId: string; nonce: string }
) =>
  `${getProjectReportPath(projectId, reportId)}/${view}?${new URLSearchParams({
    revision: snapshot.revisionId,
    nonce: snapshot.nonce,
  })}`;

export function getWorkspaceDocPath(workspaceId: string, docId: string) {
  return `/workspace/${workspaceId}/${docId}`;
}

export const REPORT_DECKS_ROUTE_PATH = '/reports';

export const getReportDecksPath = () => REPORT_DECKS_ROUTE_PATH;

export const getNewReportDeckPath = (handoffId?: string) =>
  handoffId
    ? `${REPORT_DECKS_ROUTE_PATH}/new?${new URLSearchParams({ handoff: handoffId })}`
    : `${REPORT_DECKS_ROUTE_PATH}/new`;

export const getReportDeckPath = (deckId: string) =>
  `${REPORT_DECKS_ROUTE_PATH}/${encodeURIComponent(deckId)}`;

export const getReportDeckPresentPath = (deckId: string) =>
  `${getReportDeckPath(deckId)}/present`;

export const getSharedReportDeckPath = (shareId: string) =>
  `/share/decks/${encodeURIComponent(shareId)}`;
