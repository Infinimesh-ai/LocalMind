import { Button, IconButton } from '@affine/component';
import { PageDetailLoading } from '@affine/component/page-detail-skeleton';
import { useGuard } from '@affine/core/components/guard';
import { getWorkspaceDocPath } from '@affine/core/desktop/route-paths';
import { ServerService } from '@affine/core/modules/cloud';
import { DocPeekPreview } from '@affine/core/modules/peek-view/view/doc-preview';
import {
  type Workspace,
  type WorkspaceMetadata,
  WorkspacesService,
} from '@affine/core/modules/workspace';
import { createDocumentScopedWorkerInitOptions } from '@affine/core/modules/workspace-engine';
import { ServerDeploymentType } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { CloseIcon, OpenInNewIcon } from '@blocksuite/icons/rc';
import {
  FrameworkScope,
  LiveData,
  useLiveData,
  useService,
} from '@toeverything/infra';
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { map } from 'rxjs';

import { PageNotFound } from '../404';
import * as styles from './source-document-peek.css';

export type SourceDocumentPeekProps = {
  workspaceId: string;
  docId: string;
  requestedLevel: 'read' | 'write';
  title?: string;
  onClose?: () => void;
};

type PeekShellProps = PropsWithChildren<{
  title?: string;
  canOpen: boolean;
  onOpen: () => void;
  onClose?: () => void;
}>;

const PeekShell = ({
  title,
  canOpen,
  onOpen,
  onClose,
  children,
}: PeekShellProps) => {
  const t = useI18n();
  const displayTitle =
    title?.trim() || t['com.affine.localmind.workbench.documentPreview']();

  return (
    <section
      className={styles.root}
      aria-label={t['com.affine.localmind.workbench.documentPreview']()}
    >
      <header className={styles.header}>
        <h2 className={styles.title} title={displayTitle}>
          {displayTitle}
        </h2>
        <div className={styles.actions}>
          <Button
            className={styles.openButton}
            prefix={<OpenInNewIcon />}
            disabled={!canOpen}
            onClick={onOpen}
          >
            {t['com.affine.localmind.workbench.openInWorkspace']()}
          </Button>
          {onClose ? (
            <IconButton
              size="20"
              tooltip={t['com.affine.localmind.workbench.closePreview']()}
              aria-label={t['com.affine.localmind.workbench.closePreview']()}
              icon={<CloseIcon />}
              onClick={onClose}
            />
          ) : null}
        </div>
      </header>
      <div className={styles.content}>{children}</div>
    </section>
  );
};

const SourcePermissionGate = ({
  docId,
  workspace,
  title,
  onOpen,
  onClose,
  onPermissionLost,
}: Omit<SourceDocumentPeekProps, 'workspaceId'> & {
  workspace: Workspace;
  onOpen: () => void;
  onPermissionLost: () => void;
}) => {
  const canRead = useGuard('Doc_Read', docId);
  const hadReadPermission = useRef(false);
  const rootReady$ = useMemo(
    () =>
      LiveData.from(
        workspace.engine.doc
          .docState$(workspace.id)
          .pipe(map(state => state.ready)),
        false
      ),
    [workspace]
  );
  const docReady$ = useMemo(
    () =>
      LiveData.from(
        workspace.engine.doc.docState$(docId).pipe(map(state => state.ready)),
        false
      ),
    [docId, workspace]
  );
  const rootReady = useLiveData(rootReady$);
  const docReady = useLiveData(docReady$);

  useEffect(
    () => workspace.engine.doc.addPriority(docId, 10),
    [docId, workspace]
  );

  useEffect(() => {
    if (canRead === true) {
      hadReadPermission.current = true;
    } else if (canRead === false && hadReadPermission.current) {
      onPermissionLost();
    }
  }, [canRead, onPermissionLost]);

  return (
    <PeekShell
      title={title}
      canOpen={canRead === true}
      onOpen={onOpen}
      onClose={onClose}
    >
      {canRead === true && rootReady && docReady ? (
        <DocPeekPreview docRef={{ docId }} />
      ) : canRead === undefined || canRead === true ? (
        <PageDetailLoading />
      ) : (
        <PageNotFound noPermission />
      )}
    </PeekShell>
  );
};

const OpenedSourceDocumentPeek = ({
  workspacesService,
  metadata,
  docId,
  requestedLevel,
  title,
  onOpen,
  onClose,
  engineWorkerInitOptions,
}: Omit<SourceDocumentPeekProps, 'workspaceId'> & {
  workspacesService: WorkspacesService;
  metadata: WorkspaceMetadata;
  onOpen: () => void;
  engineWorkerInitOptions: ReturnType<
    typeof createDocumentScopedWorkerInitOptions
  >;
}) => {
  const [sourceWorkspace, setSourceWorkspace] = useState<Workspace>();
  const [openFailed, setOpenFailed] = useState(false);
  const [closed, setClosed] = useState(false);
  const disposeRef = useRef<(() => void) | null>(null);

  const disposeCurrent = useCallback(() => {
    const dispose = disposeRef.current;
    disposeRef.current = null;
    dispose?.();
  }, []);

  useEffect(() => {
    setOpenFailed(false);

    try {
      const ref = workspacesService.open(
        {
          metadata,
          docScopeId: docId,
          docScopeAccess: requestedLevel,
        },
        engineWorkerInitOptions
      );
      let disposed = false;
      const dispose = () => {
        if (disposed) {
          return;
        }
        disposed = true;
        ref.dispose();
      };

      disposeRef.current = dispose;
      setSourceWorkspace(ref.workspace);

      return () => {
        if (disposeRef.current === dispose) {
          disposeRef.current = null;
        }
        dispose();
      };
    } catch {
      setOpenFailed(true);
      return;
    }
  }, [
    docId,
    engineWorkerInitOptions,
    metadata,
    requestedLevel,
    workspacesService,
  ]);

  const handleClose = useCallback(() => {
    setClosed(true);
    setSourceWorkspace(undefined);
    disposeCurrent();
    onClose?.();
  }, [disposeCurrent, onClose]);

  if (closed) {
    return null;
  }

  if (!sourceWorkspace) {
    return (
      <PeekShell
        title={title}
        canOpen={false}
        onOpen={onOpen}
        onClose={handleClose}
      >
        {openFailed ? <PageNotFound noPermission /> : <PageDetailLoading />}
      </PeekShell>
    );
  }

  return (
    <FrameworkScope scope={sourceWorkspace.scope}>
      <SourcePermissionGate
        workspace={sourceWorkspace}
        docId={docId}
        requestedLevel={requestedLevel}
        title={title}
        onOpen={onOpen}
        onClose={handleClose}
        onPermissionLost={handleClose}
      />
    </FrameworkScope>
  );
};

export const SourceDocumentPeek = ({
  workspaceId,
  docId,
  requestedLevel,
  title,
  onClose,
}: SourceDocumentPeekProps) => {
  const workspacesService = useService(WorkspacesService);
  const server = useService(ServerService).server;
  const navigate = useNavigate();
  const metadata = useMemo(
    (): WorkspaceMetadata => ({ id: workspaceId, flavour: server.id }),
    [server.id, workspaceId]
  );
  const engineWorkerInitOptions = useMemo(
    () =>
      createDocumentScopedWorkerInitOptions({
        workspaceId,
        docId,
        access: requestedLevel,
        serverBaseUrl: server.baseUrl,
        isSelfHosted:
          server.config$.value.type === ServerDeploymentType.Selfhosted,
      }),
    [docId, requestedLevel, server, workspaceId]
  );
  const openInWorkspace = useCallback(() => {
    const params = new URLSearchParams({
      server: server.baseUrl,
      docScope: docId,
      access: requestedLevel,
    });
    navigate(`${getWorkspaceDocPath(workspaceId, docId)}?${params}`);
  }, [docId, navigate, requestedLevel, server.baseUrl, workspaceId]);

  return (
    <OpenedSourceDocumentPeek
      key={JSON.stringify([workspaceId, docId])}
      workspacesService={workspacesService}
      metadata={metadata}
      docId={docId}
      requestedLevel={requestedLevel}
      title={title}
      onOpen={openInWorkspace}
      onClose={onClose}
      engineWorkerInitOptions={engineWorkerInitOptions}
    />
  );
};
