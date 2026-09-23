import { IconButton, Popover } from '@affine/component';
import {
  AppDownloadButton,
  AppSidebar,
  MenuItem,
  MenuLinkItem,
  SidebarContainer,
  SidebarScrollableContainer,
} from '@affine/core/modules/app-sidebar/views';
import { ExternalMenuLinkItem } from '@affine/core/modules/app-sidebar/views/menu-item/external-menu-link-item';
import { AuthService, ServerService } from '@affine/core/modules/cloud';
import { WorkspaceDialogService } from '@affine/core/modules/dialogs';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { CMDKQuickSearchService } from '@affine/core/modules/quicksearch/services/cmdk';
import type { Workspace } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import { track } from '@affine/track';
import type { Store } from '@blocksuite/affine/store';
import {
  AiOutlineIcon,
  AllDocsIcon,
  CheckBoxCheckLinearIcon,
  HelpIcon,
  ImportIcon,
  JournalIcon,
  MoreHorizontalIcon,
  SearchIcon,
  SettingsIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService, useServices } from '@toeverything/infra';
import type { ReactElement } from 'react';
import { memo, useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
  NavigationPanelCollections,
  NavigationPanelFavorites,
  NavigationPanelMigrationFavorites,
  NavigationPanelTags,
} from '../../desktop/components/navigation-panel';
import { WorkbenchService } from '../../modules/workbench';
import { WorkspaceNavigator } from '../workspace-selector';
import {
  bottomContainer,
  moreContent,
  shortcut,
  shortcuts,
  workspaceAndUserWrapper,
  workspaceWrapper,
} from './index.css';
import { InviteMembersButton } from './invite-members-button';
import { AppSidebarJournalButton } from './journal-button';
import { NotificationButton } from './notification-button';
import { SidebarShortcutLink } from './shortcut';
import { SidebarAudioPlayer } from './sidebar-audio-player';
import { TemplateDocEntrance } from './template-doc-entrance';
import { TrashButton } from './trash-button';
import { UpdaterButton } from './updater-button';
import UserInfo from './user-info';
import { SidebarWorkspaces } from './workspaces';

export type RootAppSidebarProps = {
  isPublicWorkspace: boolean;
  onOpenQuickSearchModal: () => void;
  onOpenSettingModal: () => void;
  currentWorkspace: Workspace;
  openPage: (pageId: string) => void;
  createPage: () => Store;
  paths: {
    all: (workspaceId: string) => string;
    trash: (workspaceId: string) => string;
    shared: (workspaceId: string) => string;
  };
};

const AllDocsButton = () => {
  const t = useI18n();
  const { workbenchService } = useServices({
    WorkbenchService,
  });
  const workbench = workbenchService.workbench;
  const allPageActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/all')
  );

  return (
    <SidebarShortcutLink
      icon={<AllDocsIcon />}
      active={allPageActive}
      to="/all"
      label={t['com.affine.workspaceSubPath.all']()}
      testId="all-pages"
    />
  );
};

const AIChatButton = () => {
  const t = useI18n();
  const location = useLocation();
  const featureFlagService = useService(FeatureFlagService);
  const serverService = useService(ServerService);
  const serverFeatures = useLiveData(serverService.server.features$);
  const enableAI = useLiveData(featureFlagService.flags.enable_ai.$);

  const aiChatActive =
    location.pathname === '/project' ||
    location.pathname.startsWith('/project/');

  if (!enableAI || !serverFeatures?.copilot) {
    return null;
  }

  return (
    <SidebarShortcutLink
      icon={<AiOutlineIcon />}
      active={aiChatActive}
      global
      to="/project"
      label={t['com.affine.localmind.workbench.projects']()}
      testId="ai-chat"
    />
  );
};

const TasksButton = () => {
  const t = useI18n();
  const location = useLocation();
  const featureFlagService = useService(FeatureFlagService);
  const serverService = useService(ServerService);
  const serverFeatures = useLiveData(serverService.server.features$);
  const enableAI = useLiveData(featureFlagService.flags.enable_ai.$);
  const active = location.pathname === '/tasks';
  const workspacePath = location.pathname.match(/^\/workspace\/[^/]+/)?.[0];
  const tasksPath = workspacePath
    ? `/tasks?${new URLSearchParams({ returnTo: `${workspacePath}/all` })}`
    : '/tasks';

  if (!enableAI || !serverFeatures?.copilot) {
    return null;
  }

  return (
    <MenuLinkItem
      icon={<CheckBoxCheckLinearIcon />}
      active={active}
      linkComponent={Link}
      to={tasksPath}
    >
      <span data-testid="copilot-tasks">
        {t['com.affine.workspaceSubPath.tasks']()}
      </span>
    </MenuLinkItem>
  );
};

const HelpButton = () => {
  const t = useI18n();
  const workbench = useService(WorkbenchService).workbench;
  const helpActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/help')
  );

  return (
    <MenuLinkItem
      icon={<HelpIcon />}
      active={helpActive}
      to="/help"
      data-testid="slider-bar-help-button"
    >
      <span>{t['com.affine.localmind.help.title']()}</span>
    </MenuLinkItem>
  );
};

/**
 * This is for the whole affine app sidebar.
 * This component wraps the app sidebar in `@affine/component` with logic and data.
 *
 */
export const RootAppSidebar = memo((): ReactElement => {
  const { workbenchService, cMDKQuickSearchService, authService } = useServices(
    {
      WorkbenchService,
      CMDKQuickSearchService,
      AuthService,
    }
  );

  const sessionStatus = useLiveData(authService.session.status$);
  const [moreOpen, setMoreOpen] = useState(false);
  const t = useI18n();
  const workspaceDialogService = useService(WorkspaceDialogService);
  const workbench = workbenchService.workbench;
  const workspaceSelectorOpen = useLiveData(workbench.workspaceSelectorOpen$);
  const onOpenQuickSearchModal = useCallback(() => {
    cMDKQuickSearchService.toggle();
  }, [cMDKQuickSearchService]);

  const onWorkspaceSelectorOpenChange = useCallback(
    (open: boolean) => {
      workbench.setWorkspaceSelectorOpen(open);
    },
    [workbench]
  );

  const onOpenSettingModal = useCallback(() => {
    setMoreOpen(false);
    workspaceDialogService.open('setting', {
      activeTab: 'appearance',
    });
    track.$.navigationPanel.$.openSettings();
  }, [workspaceDialogService]);

  const handleOpenDocs = useCallback(
    (result: {
      docIds: string[];
      officeArtifactId?: string;
      entryId?: string;
      isWorkspaceFile?: boolean;
    }) => {
      const { docIds, officeArtifactId, entryId, isWorkspaceFile } = result;
      if (officeArtifactId) {
        workbench.openOffice(officeArtifactId);
        return;
      }
      // If the imported file is a workspace file, open the entry page.
      if (isWorkspaceFile && entryId) {
        workbench.openDoc(entryId);
      } else if (!docIds.length) {
        return;
      }
      // Open all the docs when there are multiple docs imported.
      if (docIds.length > 1) {
        workbench.openAll();
      } else {
        // Otherwise, open the only doc.
        workbench.openDoc(docIds[0]);
      }
    },
    [workbench]
  );

  const onOpenImportModal = useCallback(() => {
    setMoreOpen(false);
    track.$.navigationPanel.importModal.open();
    workspaceDialogService.open('import', undefined, payload => {
      if (!payload) {
        return;
      }
      handleOpenDocs(payload);
    });
  }, [workspaceDialogService, handleOpenDocs]);

  return (
    <AppSidebar>
      <SidebarContainer>
        <div className={workspaceAndUserWrapper}>
          <div className={workspaceWrapper}>
            <WorkspaceNavigator
              showEnableCloudButton
              showSyncStatus
              open={workspaceSelectorOpen}
              onOpenChange={onWorkspaceSelectorOpenChange}
              dense
            />
          </div>
          <UserInfo />
        </div>
        <div
          className={shortcuts}
          aria-label={t['com.affine.rootAppSidebar.shortcuts']()}
        >
          <IconButton
            className={shortcut}
            aria-label={t['Quick search']()}
            tooltip={t['Quick search']()}
            data-testid="slider-bar-quick-search-button"
            data-event-props="$.navigationPanel.$.quickSearch"
            onClick={onOpenQuickSearchModal}
          >
            <SearchIcon />
          </IconButton>
          <AllDocsButton />
          <AppSidebarJournalButton compact />
          {sessionStatus === 'authenticated' && <NotificationButton iconOnly />}
          <AIChatButton />
          <Popover
            open={moreOpen}
            onOpenChange={setMoreOpen}
            contentOptions={{
              className: moreContent,
              side: 'bottom',
              align: 'end',
              collisionPadding: 12,
              'aria-label': t['com.affine.rootAppSidebar.more'](),
            }}
            content={
              <div
                onClickCapture={event => {
                  const target = event.target as HTMLElement;
                  if (target.closest('a')) {
                    // A microtask can run between native capture and bubble
                    // listeners. Wait for the entire click dispatch (including
                    // links that stop propagation) before unmounting the menu.
                    setTimeout(() => setMoreOpen(false), 0);
                  }
                }}
              >
                <TasksButton />
                <MenuItem
                  data-testid="slider-bar-workspace-setting-button"
                  icon={<SettingsIcon />}
                  onClick={onOpenSettingModal}
                >
                  <span data-testid="settings-modal-trigger">
                    {t['com.affine.settingSidebar.title']()}
                  </span>
                </MenuItem>
                <HelpButton />
                <TrashButton />
                <MenuItem
                  data-testid="slider-bar-import-button"
                  icon={<ImportIcon />}
                  onClick={onOpenImportModal}
                >
                  <span data-testid="import-modal-trigger">
                    {t['Import']()}
                  </span>
                </MenuItem>
                <InviteMembersButton onOpen={() => setMoreOpen(false)} />
                <TemplateDocEntrance />
                <ExternalMenuLinkItem
                  href={`${BUILD_CONFIG.githubUrl}/releases`}
                  icon={<JournalIcon />}
                  label={t['com.affine.app-sidebar.learn-more']()}
                />
                <NavigationPanelFavorites />
                <NavigationPanelMigrationFavorites />
                <NavigationPanelTags />
                <NavigationPanelCollections />
                {BUILD_CONFIG.isElectron ? (
                  <UpdaterButton />
                ) : (
                  <AppDownloadButton />
                )}
              </div>
            }
          >
            <IconButton
              className={shortcut}
              aria-label={t['com.affine.rootAppSidebar.more']()}
              tooltip={t['com.affine.rootAppSidebar.more']()}
              data-testid="sidebar-more-button"
            >
              <MoreHorizontalIcon />
            </IconButton>
          </Popover>
        </div>
      </SidebarContainer>
      <SidebarScrollableContainer>
        <SidebarWorkspaces />
      </SidebarScrollableContainer>
      <SidebarContainer className={bottomContainer}>
        <SidebarAudioPlayer />
      </SidebarContainer>
    </AppSidebar>
  );
});

RootAppSidebar.displayName = 'memo(RootAppSidebar)';
