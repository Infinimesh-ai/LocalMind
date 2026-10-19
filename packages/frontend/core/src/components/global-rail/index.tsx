import { Tooltip } from '@affine/component';
import { LocalMindLogo } from '@affine/component/localmind-logo';
import {
  getProjectDocumentsPath,
  getReportDecksPath,
  PROJECT_ROUTE_PATH,
  REPORT_DECKS_ROUTE_PATH,
} from '@affine/core/desktop/route-paths';
import { WorkspaceDialogService } from '@affine/core/modules/dialogs';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import {
  AllDocsIcon,
  CheckBoxCheckLinearIcon,
  GridIcon,
  HomeIcon,
  PresentationIcon,
  SettingsIcon,
} from '@blocksuite/icons/rc';
import { useServiceOptional } from '@toeverything/infra';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import UserInfo from '../root-app-sidebar/user-info';
import * as styles from './global-rail.css';
import { lastProjectId, lastWorkspaceId } from './last-location';

export {
  lastProjectId,
  lastWorkspaceId,
  rememberLastProjectId,
} from './last-location';

export type GlobalRailItem =
  | 'workspace'
  | 'projects'
  | 'docs'
  | 'reports'
  | 'tasks';

const TASKS_PATH = '/tasks';

const isUnder = (pathname: string, root: string) =>
  pathname === root || pathname.startsWith(`${root}/`);

/** Which rail destination the current app location belongs to. */
export function globalRailActiveItem(
  pathname: string,
  search = ''
): GlobalRailItem | null {
  if (pathname === TASKS_PATH || /^\/workspace\/[^/]+\/tasks$/.test(pathname))
    return 'tasks';
  if (pathname.startsWith('/workspace/')) return 'workspace';
  if (isUnder(pathname, PROJECT_ROUTE_PATH))
    return new URLSearchParams(search).get('view') === 'files'
      ? 'docs'
      : 'projects';
  if (isUnder(pathname, REPORT_DECKS_ROUTE_PATH)) return 'reports';
  return null;
}

/** Tasks remember the workspace they were opened from, like the sidebar link. */
export function globalRailTasksPath(pathname: string) {
  const workspacePath = pathname.match(/^\/workspace\/[^/]+/)?.[0];
  return workspacePath
    ? `${TASKS_PATH}?${new URLSearchParams({ returnTo: `${workspacePath}/all` })}`
    : TASKS_PATH;
}

function RailButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        className={styles.switchButton}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

export type GlobalRailProps = {
  className?: string;
  /** Project used by "Project documents"; defaults to the last selected one. */
  projectId?: string | null;
  /** Overrides the destination derived from the current location. */
  active?: GlobalRailItem | null;
  /** Defaults to the app router (the workbench for the current workspace). */
  onNavigate?: (path: string) => void;
  /** Defaults to the workspace settings dialog when inside a workspace. */
  onOpenSettings?: () => void;
  /** Projects, reports and tasks are AI features; hidden when AI is off. */
  aiAvailable?: boolean;
};

/** App-level destinations shared by the workspace, project and report pages. */
export function GlobalRail({
  className,
  projectId,
  active,
  onNavigate,
  onOpenSettings,
  aiAvailable = true,
}: GlobalRailProps) {
  const t = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const currentWorkspaceId =
    useServiceOptional(WorkspaceService)?.workspace.id ?? null;
  const workbench = useServiceOptional(WorkbenchService)?.workbench;
  const workspaceDialog = useServiceOptional(WorkspaceDialogService);

  const current =
    active === undefined
      ? globalRailActiveItem(location.pathname, location.search)
      : active;
  const workspaceId = currentWorkspaceId ?? lastWorkspaceId();
  const workspacePath = workspaceId
    ? `/workspace/${encodeURIComponent(workspaceId)}`
    : '/';
  const documentsProjectId =
    projectId === undefined ? lastProjectId() : projectId;

  const go = (path: string) => {
    if (onNavigate) onNavigate(path);
    else void navigate(path);
  };
  const openWorkspace = () => {
    if (!onNavigate && workbench && currentWorkspaceId) {
      workbench.openAll();
      return;
    }
    go(workspacePath);
  };
  // Outside a workspace (report pages) the settings route of the last
  // workspace opens the same dialog, so the rail keeps all its buttons.
  const openSettings =
    onOpenSettings ??
    (workspaceDialog
      ? () => workspaceDialog.open('setting', { activeTab: 'appearance' })
      : workspaceId
        ? () => go(`${workspacePath}/settings?tab=appearance`)
        : undefined);

  return (
    <nav
      className={clsx(styles.rail, className)}
      aria-label={t['com.affine.localmind.workbench.systemRail.label']()}
      data-testid="global-rail"
    >
      <button
        type="button"
        className={styles.logo}
        aria-label={t['com.affine.localmind.workbench.returnToWorkspace']()}
        onClick={openWorkspace}
      >
        <LocalMindLogo size={28} />
      </button>
      <div className={styles.main}>
        <RailButton
          label={t['com.affine.localmind.workbench.systemRail.workspace']()}
          icon={<HomeIcon />}
          active={current === 'workspace'}
          onClick={openWorkspace}
        />
        {aiAvailable ? (
          <RailButton
            label={t['com.affine.localmind.workbench.systemRail.projects']()}
            icon={<GridIcon />}
            active={current === 'projects'}
            onClick={() => go(PROJECT_ROUTE_PATH)}
          />
        ) : null}
        {aiAvailable ? (
          <RailButton
            label={t['com.affine.localmind.workbench.systemRail.docs']()}
            icon={<AllDocsIcon />}
            active={current === 'docs'}
            onClick={() => go(getProjectDocumentsPath(documentsProjectId))}
          />
        ) : null}
        {aiAvailable ? (
          <RailButton
            label={t['com.affine.localmind.workbench.systemRail.reports']()}
            icon={<PresentationIcon />}
            active={current === 'reports'}
            onClick={() => go(getReportDecksPath())}
          />
        ) : null}
      </div>
      <div className={styles.bottom}>
        {aiAvailable ? (
          <RailButton
            label={t['com.affine.localmind.workbench.systemRail.tasks']()}
            icon={<CheckBoxCheckLinearIcon />}
            active={current === 'tasks'}
            onClick={() => go(globalRailTasksPath(location.pathname))}
          />
        ) : null}
        {openSettings ? (
          <RailButton
            label={t['com.affine.settingSidebar.title']()}
            icon={<SettingsIcon />}
            onClick={openSettings}
          />
        ) : null}
        <UserInfo className={styles.switchButton} inRail />
      </div>
    </nav>
  );
}
