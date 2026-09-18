import { DNDContext } from '@affine/component';
import { AffineOtherPageLayout } from '@affine/component/affine-other-page-layout';
import { workbenchRoutes } from '@affine/core/desktop/workbench-router';
import {
  DefaultServerService,
  ServersService,
} from '@affine/core/modules/cloud';
import { GlobalDialogService } from '@affine/core/modules/dialogs';
import { DndService } from '@affine/core/modules/dnd/services';
import { GlobalContextService } from '@affine/core/modules/global-context';
import { OpenInAppGuard } from '@affine/core/modules/open-in-app';
import {
  getAFFiNEWorkspaceSchema,
  type Workspace,
  type WorkspaceMetadata,
  WorkspacesService,
  WorkspaceSwitchService,
} from '@affine/core/modules/workspace';
import {
  createDocumentScopedWorkerInitOptions,
  type DocumentScopeAccess,
} from '@affine/core/modules/workspace-engine';
import { ServerDeploymentType } from '@affine/graphql';
import type { WorkerInitOptions } from '@affine/nbstore/worker/client';
import { ZipTransformer } from '@blocksuite/affine/widgets/linked-doc';
import {
  FrameworkScope,
  useLiveData,
  useService,
  useServices,
} from '@toeverything/infra';
import type { PropsWithChildren, ReactElement } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  matchPath,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import * as _Y from 'yjs';

import { AffineErrorBoundary } from '../../../components/affine/affine-error-boundary';
import { WorkbenchRoot } from '../../../modules/workbench';
import { AppContainer } from '../../components/app-container';
import { PageNotFound } from '../404';
import { resolveDocumentScopeAccess } from './document-scope-route';
import { WorkspaceLayout } from './layouts/workspace-layout';
import { SharePage } from './share/share-page';

declare global {
  /**
   * @internal debug only
   */
  // oxlint-disable-next-line no-var
  var currentWorkspace: Workspace | undefined;
  // oxlint-disable-next-line no-var
  var exportWorkspaceSnapshot: (docs?: string[]) => Promise<void>;
  // oxlint-disable-next-line no-var
  var importWorkspaceSnapshot: () => Promise<void>;
  // oxlint-disable-next-line no-var
  var Y: typeof _Y;
  interface WindowEventMap {
    'affine:workspace:change': CustomEvent<{ id: string }>;
  }
}

globalThis.Y = _Y;

export const Component = (): ReactElement => {
  const {
    workspacesService,
    globalDialogService,
    serversService,
    defaultServerService,
    globalContextService,
    workspaceSwitchService,
  } = useServices({
    WorkspacesService,
    GlobalDialogService,
    ServersService,
    DefaultServerService,
    GlobalContextService,
    WorkspaceSwitchService,
  });

  const params = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const switchState = useLiveData(workspaceSwitchService.state$);

  // check if we are in detail doc route, if so, maybe render share page
  const detailDocRoute = useMemo(() => {
    const match = matchPath(
      '/workspace/:workspaceId/:docId',
      location.pathname
    );
    if (
      match &&
      match.params.docId &&
      match.params.workspaceId &&
      // TODO(eyhn): need a better way to check if it's a docId
      workbenchRoutes.find(route =>
        matchPath(route.path, '/' + match.params.docId)
      )?.path === '/:pageId'
    ) {
      return {
        docId: match.params.docId,
        workspaceId: match.params.workspaceId,
      };
    } else {
      return null;
    }
  }, [location.pathname]);

  const [workspaceNotFound, setWorkspaceNotFound] = useState(false);
  const listLoading = useLiveData(workspacesService.list.isRevalidating$);
  const workspaces = useLiveData(workspacesService.list.workspaces$);
  const meta = useMemo(() => {
    return workspaces.find(({ id }) => id === params.workspaceId);
  }, [workspaces, params.workspaceId]);

  const metadataLookupRef = useRef({
    workspaceId: '',
    refreshRequested: false,
  });
  useEffect(() => {
    metadataLookupRef.current = {
      workspaceId: params.workspaceId ?? '',
      refreshRequested: false,
    };
    setWorkspaceNotFound(false);
  }, [params.workspaceId]);

  // Known workspaces open from the current list without a refresh. An unknown
  // route gets exactly one coalesced metadata refresh before resolving to 404.
  useEffect(() => {
    if (!params.workspaceId || meta) {
      setWorkspaceNotFound(false);
      return;
    }
    if (listLoading) {
      return;
    }

    const lookup = metadataLookupRef.current;
    if (lookup.workspaceId === params.workspaceId && !lookup.refreshRequested) {
      lookup.refreshRequested = true;
      workspacesService.list.revalidate();
      return;
    }
    setWorkspaceNotFound(true);
  }, [listLoading, meta, params.workspaceId, workspacesService]);

  // server search params
  const serverFromSearchParams = useLiveData(
    searchParams.has('server')
      ? serversService.serverByBaseUrl$(searchParams.get('server') as string)
      : undefined
  );
  // server from workspace
  const serverFromWorkspace = useLiveData(
    meta?.flavour && meta.flavour !== 'local'
      ? serversService.server$(meta?.flavour)
      : undefined
  );
  const server = serverFromWorkspace ?? serverFromSearchParams;
  const hasDocumentScopeRequest = searchParams.has('docScope');
  const documentScopeAccess =
    detailDocRoute && hasDocumentScopeRequest
      ? resolveDocumentScopeAccess(searchParams, detailDocRoute.docId)
      : null;
  const documentScopedMeta = useMemo<WorkspaceMetadata | null>(
    () =>
      detailDocRoute && documentScopeAccess && server
        ? { id: detailDocRoute.workspaceId, flavour: server.id }
        : null,
    [detailDocRoute, documentScopeAccess, server]
  );
  const documentScopedWorkerInitOptions = useMemo(
    () =>
      detailDocRoute && documentScopeAccess && server
        ? createDocumentScopedWorkerInitOptions({
            workspaceId: detailDocRoute.workspaceId,
            docId: detailDocRoute.docId,
            access: documentScopeAccess,
            serverBaseUrl: server.baseUrl,
            isSelfHosted:
              server.config$.value.type === ServerDeploymentType.Selfhosted,
          })
        : null,
    [detailDocRoute, documentScopeAccess, server]
  );
  const documentScope = useMemo(
    () =>
      detailDocRoute && documentScopeAccess && documentScopedWorkerInitOptions
        ? {
            docId: detailDocRoute.docId,
            access: documentScopeAccess,
            workerInitOptions: documentScopedWorkerInitOptions,
          }
        : null,
    [detailDocRoute, documentScopeAccess, documentScopedWorkerInitOptions]
  );

  useEffect(() => {
    if (server) {
      globalContextService.globalContext.serverId.set(server.id);
      return () => {
        globalContextService.globalContext.serverId.set(
          defaultServerService.server.id
        );
      };
    }
    return;
  }, [
    defaultServerService.server.id,
    globalContextService.globalContext.serverId,
    server,
  ]);

  // if server is not found, and we have server in search params, we should show add selfhosted dialog
  const needAddSelfhosted = server === undefined && searchParams.has('server');
  // use ref to avoid useEffect trigger twice
  const addSelfhostedDialogOpened = useRef<boolean>(false);

  useEffect(() => {
    if (addSelfhostedDialogOpened.current) {
      return;
    }
    addSelfhostedDialogOpened.current = true;
    if (BUILD_CONFIG.isElectron && needAddSelfhosted) {
      globalDialogService.open('sign-in', {
        server: searchParams.get('server') as string,
      });
    }
    return;
  }, [
    globalDialogService,
    needAddSelfhosted,
    searchParams,
    serverFromSearchParams,
  ]);

  if (hasDocumentScopeRequest) {
    if (
      !detailDocRoute ||
      !documentScopeAccess ||
      !documentScopedMeta ||
      !documentScope ||
      !server
    ) {
      return (
        <FrameworkScope scope={server?.scope}>
          <AffineOtherPageLayout>
            <PageNotFound noPermission />
          </AffineOtherPageLayout>
        </FrameworkScope>
      );
    }

    return (
      <FrameworkScope scope={server.scope}>
        <WorkspacePage
          meta={documentScopedMeta}
          documentScope={documentScope}
          switchRequestId={
            switchState.phase !== 'idle' &&
            switchState.source === 'click' &&
            switchState.targetWorkspaceId === documentScopedMeta.id
              ? switchState.switchId
              : undefined
          }
        />
      </FrameworkScope>
    );
  }

  if (workspaceNotFound) {
    if (detailDocRoute) {
      return (
        <FrameworkScope scope={server?.scope}>
          <SharePage
            docId={detailDocRoute.docId}
            workspaceId={detailDocRoute.workspaceId}
          />
        </FrameworkScope>
      );
    }
    return (
      <FrameworkScope scope={server?.scope}>
        <AffineOtherPageLayout>
          <PageNotFound noPermission />
        </AffineOtherPageLayout>
      </FrameworkScope>
    );
  }
  if (!meta) {
    return <AppContainer fallback />;
  }

  return (
    <FrameworkScope scope={server?.scope}>
      <WorkspacePage
        meta={meta}
        switchRequestId={
          switchState.phase !== 'idle' &&
          switchState.source === 'click' &&
          switchState.targetWorkspaceId === meta.id
            ? switchState.switchId
            : undefined
        }
      />
    </FrameworkScope>
  );
};

const DNDContextProvider = ({ children }: PropsWithChildren) => {
  const dndService = useService(DndService);
  const contextValue = useMemo(() => {
    return {
      fromExternalData: dndService.fromExternalData,
      toExternalData: dndService.toExternalData,
    };
  }, [dndService.fromExternalData, dndService.toExternalData]);
  return (
    <DNDContext.Provider value={contextValue}>{children}</DNDContext.Provider>
  );
};

type WorkspacePageProps = {
  meta: WorkspaceMetadata;
  switchRequestId?: string;
  documentScope?: {
    docId: string;
    access: DocumentScopeAccess;
    workerInitOptions: WorkerInitOptions;
  };
};

type OpenedWorkspace = {
  workspace: Workspace;
  switchId: string;
  dispose: (options?: { warm?: boolean }) => void;
  reused: boolean;
  validateAccess?: (signal?: AbortSignal) => Promise<void>;
  lastSyncState?: {
    ready: boolean;
    synced: boolean;
    syncing: boolean;
    syncRetrying: boolean;
    syncErrorMessage: string | null;
  };
  remoteConnectedMarked?: boolean;
};

const WorkspacePage = ({
  meta,
  documentScope,
  switchRequestId,
}: WorkspacePageProps) => {
  const { workspacesService, globalContextService, workspaceSwitchService } =
    useServices({
      WorkspacesService,
      GlobalContextService,
      WorkspaceSwitchService,
    });

  const [active, setActive] = useState<OpenedWorkspace | null>(null);
  const activeRef = useRef<OpenedWorkspace | null>(null);
  const pendingRef = useRef<OpenedWorkspace | null>(null);
  const retiredRef = useRef<OpenedWorkspace[]>([]);
  const generationRef = useRef(0);

  const openOptions = useMemo(
    () => ({
      metadata: {
        id: meta.id,
        flavour: meta.flavour,
        initialized: meta.initialized,
      },
      docScopeId: documentScope?.docId,
      docScopeAccess: documentScope?.access,
    }),
    [
      documentScope?.access,
      documentScope?.docId,
      meta.flavour,
      meta.id,
      meta.initialized,
    ]
  );

  useLayoutEffect(() => {
    const switchId = workspaceSwitchService.routeCommitted(
      openOptions.metadata.id
    );
    workspaceSwitchService.phase(switchId, 'preparing');
    workspaceSwitchService.engineStarted(switchId);
    const generation = ++generationRef.current;
    let committed = false;
    let failed = false;
    let candidate: OpenedWorkspace;
    try {
      const ref = workspacesService.open(
        openOptions,
        documentScope?.workerInitOptions
      );
      candidate = { ...ref, switchId };
      pendingRef.current = candidate;
    } catch (error) {
      workspaceSwitchService.fail(switchId, 'open', error);
      return;
    }

    const accessAbort = new AbortController();
    let accessValidated = !candidate.reused || !candidate.validateAccess;
    const failBeforeCommit = (failurePhase: string, error: unknown) => {
      if (committed || failed) {
        return;
      }
      failed = true;
      accessAbort.abort(error);
      if (pendingRef.current === candidate) {
        pendingRef.current = null;
      }
      candidate.dispose({ warm: false });
      workspaceSwitchService.fail(switchId, failurePhase, error);
    };
    const commitIfReady = () => {
      if (
        committed ||
        failed ||
        !accessValidated ||
        !(
          candidate.workspace.localRootReady || candidate.lastSyncState?.ready
        ) ||
        generation !== generationRef.current ||
        !workspaceSwitchService.isCurrent(switchId)
      ) {
        return;
      }

      committed = true;
      pendingRef.current = null;
      workspaceSwitchService.phase(switchId, 'local-ready');
      const previous = activeRef.current;
      activeRef.current = candidate;
      if (previous && previous !== candidate) {
        retiredRef.current.push(previous);
      }
      setActive(candidate);
    };

    const subscription = candidate.workspace.engine.doc
      .docState$(candidate.workspace.id)
      .subscribe({
        next: state => {
          candidate.lastSyncState = state;
          if (state.ready) {
            candidate.workspace.markLocalRootReady();
          }
          if (
            generation !== generationRef.current ||
            !workspaceSwitchService.isCurrent(switchId)
          ) {
            return;
          }

          if (
            !candidate.remoteConnectedMarked &&
            candidate.workspace.flavour !== 'local' &&
            (state.syncing || state.synced)
          ) {
            candidate.remoteConnectedMarked = true;
            workspaceSwitchService.remoteConnected(switchId);
          }

          if (!committed && state.syncErrorMessage && !state.ready) {
            failBeforeCommit(
              'local-root',
              new Error('Workspace root is unavailable')
            );
            return;
          }

          if (!committed) {
            commitIfReady();
            return;
          }

          if (!committed || activeRef.current !== candidate) {
            return;
          }
          if (state.syncErrorMessage) {
            workspaceSwitchService.fail(
              switchId,
              'remote-sync',
              new Error('Workspace remote sync failed')
            );
          } else if (state.synced) {
            workspaceSwitchService.phase(switchId, 'ready');
          } else if (state.syncing || state.syncRetrying) {
            workspaceSwitchService.phase(switchId, 'syncing');
          }
        },
        error: error => {
          if (generation !== generationRef.current || committed) {
            return;
          }
          failBeforeCommit('local-root', error);
        },
      });

    commitIfReady();

    if (!accessValidated) {
      void candidate.validateAccess?.(accessAbort.signal).then(
        () => {
          accessValidated = true;
          commitIfReady();
        },
        error => {
          if (generation === generationRef.current) {
            failBeforeCommit('access-check', error);
          }
        }
      );
    }

    return () => {
      accessAbort.abort(new Error('Workspace switch superseded'));
      subscription.unsubscribe();
      if (!committed && !failed) {
        if (pendingRef.current === candidate) {
          pendingRef.current = null;
        }
        candidate.dispose({ warm: false });
      }
    };
  }, [
    documentScope?.workerInitOptions,
    openOptions,
    switchRequestId,
    workspacesService,
    workspaceSwitchService,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }
    for (const retired of retiredRef.current.splice(0)) {
      retired.dispose();
    }
    workspaceSwitchService.phase(active.switchId, 'committed');
    if (active.lastSyncState?.syncErrorMessage) {
      workspaceSwitchService.fail(
        active.switchId,
        'remote-sync',
        new Error('Workspace remote sync failed')
      );
    } else if (active.lastSyncState?.synced) {
      workspaceSwitchService.phase(active.switchId, 'ready');
    } else {
      workspaceSwitchService.phase(active.switchId, 'syncing');
    }
  }, [active, workspaceSwitchService]);

  useEffect(
    () => () => {
      generationRef.current++;
      pendingRef.current?.dispose({ warm: false });
      pendingRef.current = null;
      activeRef.current?.dispose();
      activeRef.current = null;
      for (const retired of retiredRef.current.splice(0)) {
        retired.dispose();
      }
    },
    []
  );

  const workspace = active?.workspace ?? null;

  useEffect(() => {
    if (workspace) {
      // for debug purpose
      window.currentWorkspace = workspace ?? undefined;
      window.dispatchEvent(
        new CustomEvent('affine:workspace:change', {
          detail: {
            id: workspace.id,
          },
        })
      );
      window.exportWorkspaceSnapshot = async (docs?: string[]) => {
        await ZipTransformer.exportDocs(
          workspace.docCollection,
          getAFFiNEWorkspaceSchema(),
          Array.from(workspace.docCollection.docs.values())
            .filter(doc => (docs ? docs.includes(doc.id) : true))
            .map(doc => doc.getStore())
        );
      };
      window.importWorkspaceSnapshot = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = async () => {
          if (input.files && input.files.length > 0) {
            const file = input.files[0];
            const blob = new Blob([file], { type: 'application/zip' });
            const newDocs = await ZipTransformer.importDocs(
              workspace.docCollection,
              getAFFiNEWorkspaceSchema(),
              blob
            );
            console.log(
              'imported docs',
              newDocs
                .filter(doc => !!doc)
                .map(doc => ({
                  id: doc.id,
                  title: doc.meta?.title,
                }))
            );
          }
        };
        input.click();
      };
      if (!workspace.openOptions.docScopeId) {
        localStorage.setItem('last_workspace_id', workspace.id);
      }
      globalContextService.globalContext.workspaceId.set(workspace.id);
      globalContextService.globalContext.workspaceFlavour.set(
        workspace.flavour
      );
      return () => {
        window.currentWorkspace = undefined;
        globalContextService.globalContext.workspaceId.set(null);
        globalContextService.globalContext.workspaceFlavour.set(null);
      };
    }
    return;
  }, [globalContextService, workspace]);

  if (!workspace) {
    return <AppContainer fallback />;
  }

  return (
    <FrameworkScope scope={workspace.scope}>
      <DNDContextProvider>
        <OpenInAppGuard>
          <AffineErrorBoundary height="100vh">
            <WorkspaceLayout>
              <WorkbenchRoot />
            </WorkspaceLayout>
          </AffineErrorBoundary>
        </OpenInAppGuard>
      </DNDContextProvider>
    </FrameworkScope>
  );
};
