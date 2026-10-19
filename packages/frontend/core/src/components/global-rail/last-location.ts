const LAST_WORKSPACE_KEY = 'last_workspace_id';
const LAST_PROJECT_KEY = 'localmind:last_project_id';

/** Same choice as the app index route: last opened workspace, else none. */
export function lastWorkspaceId() {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

/** Last project selected on the project page, used by the rail outside it. */
export function lastProjectId() {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function rememberLastProjectId(projectId: string | null) {
  try {
    if (projectId) localStorage.setItem(LAST_PROJECT_KEY, projectId);
  } catch {
    // Storage may be blocked; the rail then falls back to the documents index.
  }
}
