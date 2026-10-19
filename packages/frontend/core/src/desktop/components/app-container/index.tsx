import { GlobalRail } from '@affine/core/components/global-rail';
import { docked as globalRailDocked } from '@affine/core/components/global-rail/global-rail.css';
import { useAppSettingHelper } from '@affine/core/components/hooks/affine/use-app-setting-helper';
import { RootAppSidebar } from '@affine/core/components/root-app-sidebar';
import { AppSidebarService } from '@affine/core/modules/app-sidebar';
import {
  AppSidebarFallback,
  OpenInAppCard,
  SidebarSwitch,
} from '@affine/core/modules/app-sidebar/views';
import { AppTabsHeader } from '@affine/core/modules/app-tabs-header';
import { ServerService } from '@affine/core/modules/cloud';
import { FeatureFlagService } from '@affine/core/modules/feature-flag';
import { NavigationButtons } from '@affine/core/modules/navigation';
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@toeverything/infra';
import clsx from 'clsx';
import {
  forwardRef,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactElement,
} from 'react';

import * as styles from './styles.css';

export const AppContainer = ({
  children,
  className,
  fallback = false,
  ...rest
}: PropsWithChildren<{
  className?: string;
  fallback?: boolean;
}>) => {
  const { appSettings } = useAppSettingHelper();
  // The workspace shell follows the Project hub look together with the rail.
  const localmindShell = useLiveData(
    useService(FeatureFlagService).flags.enable_global_rail.$
  );

  const noisyBackground =
    BUILD_CONFIG.isElectron && appSettings.enableNoisyBackground;
  const blurBackground =
    BUILD_CONFIG.isElectron &&
    environment.isMacOs &&
    appSettings.enableBlurBackground;
  return (
    <div
      {...rest}
      className={clsx(styles.appStyle, className, {
        'noisy-background': noisyBackground,
        'blur-background': blurBackground,
      })}
      data-noise-background={noisyBackground}
      data-translucent={blurBackground}
      data-localmind-shell={!!localmindShell}
    >
      <LayoutComponent fallback={fallback}>{children}</LayoutComponent>
    </div>
  );
};

/**
 * Workspace shell rail, left of the app sidebar (`enable_global_rail`). It is
 * also drawn while the workspace loads so switching from the project or
 * report pages keeps the rail in place instead of flashing.
 */
const WorkspaceGlobalRail = ({ show }: { show: boolean }) => {
  const featureFlagService = useService(FeatureFlagService);
  const enabled = useLiveData(featureFlagService.flags.enable_global_rail.$);
  const enableAI = useLiveData(featureFlagService.flags.enable_ai.$);
  const server = useServiceOptional(ServerService)?.server;
  const serverFeatures = useLiveData(server?.features$);
  if (!show || !enabled) return null;
  return (
    <GlobalRail
      className={globalRailDocked}
      aiAvailable={!!enableAI && !!serverFeatures?.copilot}
    />
  );
};

const DesktopLayout = ({
  children,
  fallback = false,
}: PropsWithChildren<{ fallback?: boolean }>) => {
  const workspaceService = useServiceOptional(WorkspaceService);
  const isInWorkspace = !!workspaceService;
  return (
    <div className={styles.desktopAppViewContainer}>
      <div className={styles.desktopTabsHeader}>
        <AppTabsHeader
          left={
            <>
              {isInWorkspace && <SidebarSwitch show />}
              {isInWorkspace && <NavigationButtons />}
            </>
          }
        />
      </div>
      <div className={styles.desktopAppViewMain}>
        <WorkspaceGlobalRail show={fallback || isInWorkspace} />
        {fallback ? (
          <AppSidebarFallback />
        ) : (
          isInWorkspace && <RootAppSidebar />
        )}
        <MainContainer>{children}</MainContainer>
      </div>
    </div>
  );
};

const BrowserLayout = ({
  children,
  fallback = false,
}: PropsWithChildren<{ fallback?: boolean }>) => {
  const workspaceService = useServiceOptional(WorkspaceService);
  const isInWorkspace = !!workspaceService;

  return (
    <div className={styles.browserAppViewContainer}>
      <OpenInAppCard />
      <WorkspaceGlobalRail show={fallback || isInWorkspace} />
      {fallback ? <AppSidebarFallback /> : isInWorkspace && <RootAppSidebar />}
      <MainContainer>{children}</MainContainer>
    </div>
  );
};

const LayoutComponent = BUILD_CONFIG.isElectron ? DesktopLayout : BrowserLayout;

const MainContainer = forwardRef<
  HTMLDivElement,
  PropsWithChildren<HTMLAttributes<HTMLDivElement>>
>(function MainContainer({ className, children, ...props }, ref): ReactElement {
  const workspaceService = useServiceOptional(WorkspaceService);
  const isInWorkspace = !!workspaceService;
  const { appSettings } = useAppSettingHelper();
  const appSidebarService = useService(AppSidebarService).sidebar;
  const open = useLiveData(appSidebarService.open$);

  return (
    <div
      {...props}
      className={clsx(styles.mainContainerStyle, className)}
      data-is-desktop={BUILD_CONFIG.isElectron}
      data-transparent={false}
      data-client-border={appSettings.clientBorder}
      data-side-bar-open={open && isInWorkspace}
      data-testid="main-container"
      ref={ref}
    >
      {children}
    </div>
  );
});

MainContainer.displayName = 'MainContainer';
