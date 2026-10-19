import { Button } from '@affine/component';
import { SWRConfigProvider } from '@affine/core/components/providers/swr-config-provider';
import { getProjectPath } from '@affine/core/desktop/route-paths';
import { AppTabsHeader } from '@affine/core/modules/app-tabs-header';
import {
  DefaultServerService,
  FetchService,
  GraphQLService,
  ServerService,
} from '@affine/core/modules/cloud';
import { GlobalDialogService } from '@affine/core/modules/dialogs';
import { createProjectReportApi } from '@affine/core/modules/project-reports/api';
import { ProjectEditorGuard } from '@affine/core/modules/project-resources/edit-guard';
import { NbstoreService } from '@affine/core/modules/storage';
import { uploadProjectBlobMutation } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { ArrowLeftSmallIcon } from '@blocksuite/icons/rc';
import { FrameworkScope, useLiveData, useService } from '@toeverything/infra';
import { useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { ReportAccessDenied } from './access';
import { ReportEditor } from './editor';
import { useReportText } from './fields';
import { ReportList } from './list';
import { ReportSchedules, ReportTemplates } from './management';
import { ReportPresentation } from './presentation';
import * as styles from './reports.css';

export { ReportList } from './list';

function ReportsRoute() {
  const { projectId = '', reportId, revisionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const t = useReportText();
  const graphql = useService(GraphQLService);
  const fetcher = useService(FetchService);
  const realtime = useService(NbstoreService).realtime;
  const baseUrl = useService(ServerService).server.serverMetadata.baseUrl;
  const api = useMemo(() => {
    const api = createProjectReportApi(graphql, fetcher, baseUrl);
    api.subscribe = (projectId, callback) => {
      let connected = false;
      const subscription = realtime
        .subscribe('project.report.changed', { projectId })
        .subscribe({
          next: event => {
            // Initial data is already loading. Reconnects still reconcile changes.
            if ('type' in event && event.type === 'ready' && !connected) {
              connected = true;
              return;
            }
            connected = true;
            callback();
          },
          // Non-members are rejected here; the page shows the access state
          // from its own query, so the realtime refusal needs no extra UI.
          error: () => {},
        });
      return () => subscription.unsubscribe();
    };
    return api;
  }, [graphql, fetcher, realtime, baseUrl]);
  const presentation =
    location.pathname.endsWith('/present') ||
    location.pathname.endsWith('/presenter');
  if (presentation && reportId)
    return (
      <ReportPresentation
        api={api}
        projectId={projectId}
        reportId={reportId}
        presenter={location.pathname.endsWith('/presenter')}
      />
    );
  const uploadImage = async (file: File) =>
    (
      await graphql.gql({
        query: uploadProjectBlobMutation,
        variables: { projectId, file },
      })
    ).uploadProjectBlob;
  if (reportId)
    return (
      <div className={styles.root}>
        {BUILD_CONFIG.isElectron && <AppTabsHeader />}
        <ReportEditor
          key={`${projectId}:${reportId}:${revisionId ?? 'draft'}`}
          api={api}
          projectId={projectId}
          reportId={reportId}
          revisionId={revisionId}
          uploadImage={uploadImage}
        />
      </div>
    );
  const tabs = [
    { path: 'reports', label: t('reports') },
    { path: 'report-templates', label: t('templates') },
    { path: 'report-schedules', label: t('schedules') },
  ] as const;
  return (
    <div className={styles.root}>
      {BUILD_CONFIG.isElectron && <AppTabsHeader />}
      <header className={styles.shellHeader}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => navigate(getProjectPath(projectId))}
        >
          <ArrowLeftSmallIcon />
          {t('backToProject')}
        </button>
        <span className={styles.brandMark} aria-hidden="true" />
        <strong>{t('reports')}</strong>
        <nav
          className={styles.viewSwitch}
          aria-label={t('navigation')}
          style={{ marginLeft: 'auto' }}
        >
          {tabs.map(tab => (
            <button
              key={tab.path}
              type="button"
              className={styles.viewSwitchButton}
              aria-current={
                location.pathname.endsWith(`/${tab.path}`) ? 'page' : undefined
              }
              onClick={() =>
                navigate(`${getProjectPath(projectId)}/${tab.path}`)
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      {location.pathname.endsWith('report-templates') ? (
        <ReportTemplates
          api={api}
          projectId={projectId}
          uploadImage={uploadImage}
        />
      ) : location.pathname.endsWith('report-schedules') ? (
        <ReportSchedules api={api} projectId={projectId} />
      ) : (
        <ReportList api={api} projectId={projectId} uploadImage={uploadImage} />
      )}
    </div>
  );
}

function SignInRequired() {
  const t = useI18n();
  const dialogs = useService(GlobalDialogService);
  return (
    <div className={styles.root}>
      {BUILD_CONFIG.isElectron && <AppTabsHeader />}
      <div className={styles.empty} role="alert">
        <h2>{t['com.affine.localmind.workbench.fusion.signInRequired']()}</h2>
        <p />
        <div className={styles.row}>
          <Button variant="primary" onClick={() => dialogs.open('sign-in', {})}>
            {t['com.affine.localmind.workbench.fusion.signIn']()}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Component() {
  const server = useService(DefaultServerService).server;
  const account = useLiveData(server?.account$);
  return (
    <FrameworkScope scope={server?.scope}>
      <SWRConfigProvider key={`${server?.id ?? ''}:${account?.id ?? ''}`}>
        {account === null ? (
          BUILD_CONFIG.isElectron ? (
            <SignInRequired />
          ) : (
            <ReportAccessDenied />
          )
        ) : (
          <ProjectEditorGuard>
            <ReportsRoute />
          </ProjectEditorGuard>
        )}
      </SWRConfigProvider>
    </FrameworkScope>
  );
}
