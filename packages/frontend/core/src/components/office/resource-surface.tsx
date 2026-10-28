import { Button, IconButton, Loading, Modal, notify } from '@affine/component';
import type { GraphQLService } from '@affine/core/modules/cloud';
import type { OfficeResourceOwner } from '@affine/core/modules/office';
import { copyTextToClipboard } from '@affine/core/utils/clipboard';
import {
  restoreProjectResourceVersionMutation,
  restoreWorkspaceNativeVersionMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { SaveIcon } from '@blocksuite/icons/rc';
import { nanoid } from 'nanoid';
import { type ReactNode, useRef, useState } from 'react';

import * as styles from './document.css';
import { DocumentEditor } from './document-editor';
import { OfficeEditorSurface } from './editor-surface';
import { PdfEditor } from './pdf';
import { PresentationEditor } from './presentation';
import type {
  OfficeResourceAdapter,
  OfficeSurfaceCapabilities,
} from './resource-adapter';
import { OfficeResourceHeader } from './resource-header';
import type { OfficeResourceSession } from './resource-session';
import { CenterState } from './resource-state';
import { OfficeRevisionHistory } from './revision-history';
import { SpreadsheetEditor } from './spreadsheet';

export function OfficeResourceSurface({
  adapter,
  session,
  owner = adapter.owner,
  graphql,
  capabilities,
  onAI,
  onComments,
  actionsEnd,
  children,
}: {
  adapter: OfficeResourceAdapter;
  session: OfficeResourceSession;
  owner?: OfficeResourceOwner;
  graphql: GraphQLService;
  capabilities: OfficeSurfaceCapabilities;
  onAI?: () => void;
  onComments?: () => void;
  actionsEnd?: ReactNode;
  children?: (parts: {
    header: ReactNode;
    body: ReactNode;
    overlays: ReactNode;
  }) => ReactNode;
}) {
  const t = useI18n();
  const restoreRequest = useRef<{
    sequence: number;
    expectedContentVersion: number;
    requestKey: string;
  } | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { artifact, revision, state } = session;
  const exportWorkbookCopy = adapter.exportWorkbookCopy;
  const header =
    artifact && revision ? (
      <OfficeResourceHeader
        title={artifact.title}
        kind={artifact.kind}
        revisionSequence={revision.sequence}
        latestSequence={artifact.currentRevision.sequence}
        historical={session.historical || session.conflict}
        busy={session.busy}
        returningLatest={session.busy}
        status={{
          text: session.conflict
            ? t['com.affine.localmind.project-files.conflict']()
            : session.historical
              ? t['com.affine.office.historical-revision-read-only']()
              : session.busy
                ? t['com.affine.localmind.project-files.saving']()
                : !capabilities.canEdit
                  ? (capabilities.readOnlyReason ??
                    t['com.affine.share-menu.option.link.readonly']())
                  : t[
                      session.unsaved
                        ? 'com.affine.localmind.project-files.unsaved'
                        : owner.kind === 'project'
                          ? 'com.affine.localmind.project-files.saved'
                          : 'com.affine.admin.saved'
                    ](),
          attention: session.unsaved || session.conflict || !!session.error,
        }}
        capabilities={capabilities}
        onLatest={() => void session.run(() => session.selectRevision(null))}
        onDownload={() =>
          void session.run(() => adapter.download(artifact, revision))
        }
        onExportWorkbook={
          artifact.kind === 'workbook' && exportWorkbookCopy
            ? () =>
                void session.run(() => exportWorkbookCopy(artifact, revision))
            : undefined
        }
        onExportPdf={
          artifact.kind === 'document'
            ? () =>
                void session.run(() => adapter.exportPdf(artifact, revision))
            : undefined
        }
        onPrint={() => window.print()}
        onHistory={() => setHistoryOpen(true)}
        onAI={onAI}
        onComments={onComments}
        actionsStart={
          <IconButton
            size="20"
            icon={<SaveIcon />}
            disabled={
              !capabilities.canEdit ||
              session.historical ||
              session.conflict ||
              session.busy ||
              !session.unsaved
            }
            tooltip={t['com.affine.localmind.project-files.save']()}
            aria-label={t['com.affine.localmind.project-files.save']()}
            onClick={() => void session.run(session.save)}
          />
        }
        actionsEnd={actionsEnd}
      />
    ) : null;
  const editorProps = revision
    ? {
        owner,
        artifactId: adapter.artifactId,
        revision,
        graphql,
        readOnly:
          !capabilities.canEdit ||
          session.historical ||
          session.conflict ||
          session.transitioning,
        onRevision: session.onRevision,
        onCommentAnchorChange: session.setCommentAnchor,
        onAiSelectionChange: session.setSelection,
        registerDraft: session.registerDraft,
        beforeSelectionChange: session.confirmUnsaved,
      }
    : null;
  const body =
    session.status === 'loading' ? (
      <CenterState>
        <Loading />
        <span>{t['com.affine.office.opening-native-document']()}</span>
      </CenterState>
    ) : !artifact ? (
      <CenterState alert>
        <strong>{t['com.affine.office.document-not-found']()}</strong>
        <span>
          {session.error ??
            t[
              'com.affine.office.the-office-artifact-may-have-been-removed-or-you-may-not-have-access'
            ]()}
        </span>
        <Button onClick={() => void session.refresh()}>
          {t['com.affine.localmind.project-files.retry']()}
        </Button>
      </CenterState>
    ) : (
      <>
        {session.error ? (
          <CenterState alert>
            <span>{session.error}</span>
            <Button onClick={() => void session.retry()}>
              {t['com.affine.localmind.project-files.retry']()}
            </Button>
          </CenterState>
        ) : null}
        {!state && !session.error ? (
          <CenterState>
            <Loading />
          </CenterState>
        ) : null}
        {state && editorProps ? (
          <OfficeEditorSurface
            kind={artifact.kind}
            state={state}
            renderDocument={value => (
              <DocumentEditor
                {...editorProps}
                latestRevisionId={artifact.currentRevision.id}
                state={value}
              />
            )}
            renderWorkbook={value => (
              <SpreadsheetEditor {...editorProps} state={value} />
            )}
            renderPresentation={value => (
              <PresentationEditor {...editorProps} state={value} />
            )}
            renderPdf={value => <PdfEditor {...editorProps} state={value} />}
            renderUnsupported={() => (
              <CenterState alert>
                <strong>
                  {t['com.affine.office.unsupported-office-state']()}
                </strong>
                <span>
                  {t[
                    'com.affine.office.the-saved-state-does-not-match-this-artifact-type'
                  ]()}
                </span>
              </CenterState>
            )}
          />
        ) : null}
      </>
    );
  const overlays = (
    <>
      {revision ? (
        <OfficeRevisionHistory
          open={historyOpen}
          adapter={adapter}
          selectedRevision={revision}
          currentSequence={artifact?.currentRevision.sequence}
          onRestore={
            capabilities.canEdit &&
            artifact &&
            (owner.kind === 'workspace' || owner.editLease)
              ? async selected => {
                  if (!(await session.confirmUnsaved())) return;
                  if (
                    !restoreRequest.current ||
                    restoreRequest.current.sequence !== selected.sequence
                  )
                    restoreRequest.current = {
                      sequence: selected.sequence,
                      expectedContentVersion: artifact.currentRevision.sequence,
                      requestKey: nanoid(),
                    };
                  if (owner.kind === 'workspace')
                    await graphql.gql({
                      query: restoreWorkspaceNativeVersionMutation,
                      variables: {
                        input: {
                          workspaceId: owner.workspaceId,
                          resourceId: adapter.artifactId,
                          kind: 'office',
                          ...restoreRequest.current,
                        },
                      },
                    });
                  else {
                    if (!owner.editLease)
                      throw new Error('Project edit lease is unavailable');
                    await graphql.gql({
                      query: restoreProjectResourceVersionMutation,
                      variables: {
                        input: {
                          projectId: owner.projectId,
                          resourceId: adapter.artifactId,
                          editLease: owner.editLease,
                          ...restoreRequest.current,
                        },
                      },
                    });
                  }
                  restoreRequest.current = null;
                  await session.refresh(true);
                  setHistoryOpen(false);
                }
              : undefined
          }
          onOpenChange={setHistoryOpen}
          onSelect={next =>
            void session.run(async () => {
              await session.selectRevision(next);
              setHistoryOpen(false);
            })
          }
        />
      ) : null}
      <Modal
        open={session.confirmOpen}
        title={t['com.affine.localmind.project-files.unsaved']()}
        onOpenChange={open => {
          if (!open && !deciding) session.decide(false);
        }}
      >
        {session.canCopyDraft ? (
          <textarea
            className={styles.draftPreview}
            aria-label={t['com.affine.office.draft-text']()}
            value={session.recoveryText()}
            readOnly
          />
        ) : null}
        <div className={styles.draftActions}>
          <Button disabled={deciding} onClick={() => session.decide(false)}>
            {t['com.affine.localmind.project-files.cancel']()}
          </Button>
          {session.canCopyDraft ? (
            <Button
              disabled={deciding}
              onClick={() => {
                void copyTextToClipboard(session.recoveryText())
                  .then(copied => {
                    if (!copied) throw new Error('Draft copy failed');
                    notify.success({
                      title: t['com.affine.office.draft-copied'](),
                    });
                  })
                  .catch(session.report);
              }}
            >
              {t['com.affine.office.copy-draft-text']()}
            </Button>
          ) : null}
          <Button
            disabled={deciding}
            onClick={() => {
              setDeciding(true);
              void session
                .discard()
                .then(() => session.decide(true))
                .catch(session.report)
                .finally(() => setDeciding(false));
            }}
          >
            {t['com.affine.localmind.project-files.discard']()}
          </Button>
          <Button
            disabled={deciding || !capabilities.canEdit || session.conflict}
            onClick={() => {
              setDeciding(true);
              void session
                .save()
                .then(() => session.decide(true))
                .catch(session.report)
                .finally(() => setDeciding(false));
            }}
          >
            {t['com.affine.localmind.project-files.save']()}
          </Button>
        </div>
      </Modal>
    </>
  );
  return children ? (
    children({ header, body, overlays })
  ) : (
    <>
      {header}
      {body}
      {overlays}
    </>
  );
}
