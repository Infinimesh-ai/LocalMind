import { Button, Input, Modal, useConfirmModal } from '@affine/component';
import * as styles from '@affine/core/components/native-files/native-files.css';
import { GraphQLService } from '@affine/core/modules/cloud';
import { useProjectUnsavedConfirmation } from '@affine/core/modules/project-resources/edit-guard';
import { useProjectEditLease } from '@affine/core/modules/project-resources/edit-lease';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import {
  copyProjectResourceMutation,
  type ProjectResourceFieldsFragment,
  projectResourceHistoryQuery,
  restoreProjectResourceVersionMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { useRef, useState } from 'react';

import { ProjectDocument } from './project-document';
import { ProjectFile } from './project-file';

export function ProjectHistoryActions({
  resource,
  onChanged,
}: {
  resource: ProjectResourceFieldsFragment;
  onChanged: () => void;
}) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const lease = useProjectEditLease();
  const confirmUnsaved = useProjectUnsavedConfirmation();
  const { openConfirmModal } = useConfirmModal();
  const [open, setOpen] = useState<'history' | 'copy' | null>(null);
  const [rows, setRows] = useState<
    { id: string; sequence: number; createdAt: string }[]
  >([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [more, setMore] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [title, setTitle] = useState(resource.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{
    requestKey: string;
    expectedContentVersion: number;
    sequence?: number;
    title?: string;
  } | null>(null);
  const load = async (before?: number) => {
    setPending(true);
    setError(null);
    try {
      const result = (
        await graphql.gql({
          query: projectResourceHistoryQuery,
          variables: {
            projectId: resource.projectId,
            resourceId: resource.id,
            before,
            limit: 25,
          },
        })
      ).projectResourceHistory;
      setRows(previous => (before ? [...previous, ...result] : result));
      setMore(result.length === 25);
      if (!before) setCurrentVersion(result[0]?.sequence ?? 0);
    } catch (caught) {
      setError(projectErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  const show = (mode: 'history' | 'copy') => {
    request.current = null;
    setPreview(null);
    setTitle(resource.title);
    setOpen(mode);
    void load().catch(setError);
  };
  const restore = async (sequence: number) => {
    if (pending || !lease?.proof || !(await confirmUnsaved())) return;
    request.current ??= {
      requestKey: nanoid(),
      expectedContentVersion: currentVersion,
      sequence,
    };
    setPending(true);
    setError(null);
    try {
      await graphql.gql({
        query: restoreProjectResourceVersionMutation,
        variables: {
          input: {
            projectId: resource.projectId,
            resourceId: resource.id,
            sequence,
            editLease: lease.proof,
            requestKey: request.current.requestKey,
            expectedContentVersion: request.current.expectedContentVersion,
          },
        },
      });
      request.current = null;
      setOpen(null);
      onChanged();
    } catch (caught) {
      setError(projectErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  const copy = async () => {
    if (pending || !title.trim() || !currentVersion) return;
    request.current ??= {
      requestKey: nanoid(),
      expectedContentVersion: currentVersion,
      title,
    };
    setPending(true);
    setError(null);
    try {
      await graphql.gql({
        query: copyProjectResourceMutation,
        variables: {
          input: {
            projectId: resource.projectId,
            resourceId: resource.id,
            title: request.current.title ?? title,
            parentId: resource.parentId,
            requestKey: request.current.requestKey,
            expectedContentVersion: request.current.expectedContentVersion,
          },
        },
      });
      request.current = null;
      setOpen(null);
      onChanged();
    } catch (caught) {
      setError(projectErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      {!resource.officeArtifactId && (
        <Button onClick={() => show('history')}>
          {t['com.affine.localmind.native-files.history']()}
        </Button>
      )}
      <Button onClick={() => show('copy')}>
        {t['com.affine.localmind.native-files.copy']()}
      </Button>
      <Modal
        open={!!open}
        title={
          open === 'copy'
            ? t['com.affine.localmind.native-files.copy']()
            : t['com.affine.localmind.native-files.history']()
        }
        width={preview === null ? 640 : 960}
        onOpenChange={value => {
          if (!value && !pending) setOpen(null);
        }}
      >
        <div className={styles.form}>
          {error && (
            <p role="alert">
              {error}{' '}
              {!request.current && (
                <Button onClick={() => void load()}>
                  {t['com.affine.error.retry']()}
                </Button>
              )}
            </p>
          )}
          {pending && <span role="status">{t['Loading']()}</span>}
          {open === 'copy' ? (
            <>
              <label>
                {t['com.affine.localmind.native-files.name']()}
                <Input
                  value={title}
                  disabled={pending || !!request.current}
                  onChange={setTitle}
                />
              </label>
              <Button
                disabled={pending || !currentVersion || !title.trim()}
                onClick={() => void copy()}
              >
                {t['com.affine.localmind.native-files.copy']()}
              </Button>
            </>
          ) : (
            <>
              <ul className={styles.list}>
                {rows.map(row => (
                  <li key={row.id} className={styles.row}>
                    <span className={styles.label}>
                      v{row.sequence} ·{' '}
                      {new Date(row.createdAt).toLocaleString()}
                    </span>
                    <Button
                      disabled={pending}
                      onClick={() => setPreview(row.sequence)}
                    >
                      {t['com.affine.localmind.native-files.preview']()}
                    </Button>
                    <Button
                      disabled={
                        pending ||
                        !lease?.proof ||
                        row.sequence === currentVersion ||
                        (!!request.current &&
                          request.current.sequence !== row.sequence)
                      }
                      onClick={() =>
                        openConfirmModal({
                          confirmText:
                            t[
                              'com.affine.localmind.native-files.restoreVersion'
                            ](),
                          cancelText: t['Cancel'](),
                          title:
                            t[
                              'com.affine.localmind.native-files.restoreVersion'
                            ](),
                          description:
                            t[
                              'com.affine.localmind.native-files.restoreVersionHint'
                            ](),
                          onConfirm: () => restore(row.sequence),
                        })
                      }
                    >
                      {t['com.affine.localmind.native-files.restoreVersion']()}
                    </Button>
                  </li>
                ))}
              </ul>
              {more && (
                <Button
                  disabled={pending}
                  onClick={() => void load(rows.at(-1)?.sequence)}
                >
                  {t['com.affine.localmind.directoryPermissions.loadMore']()}
                </Button>
              )}
              {preview !== null &&
                (resource.kind === 'file' ? (
                  <ProjectFile
                    key={preview}
                    projectId={resource.projectId}
                    resourceId={resource.id}
                    title={resource.title}
                    sequence={preview}
                  />
                ) : resource.kind === 'page' || resource.kind === 'edgeless' ? (
                  <ProjectDocument
                    key={preview}
                    projectId={resource.projectId}
                    resourceId={resource.id}
                    title={resource.title}
                    mode={resource.kind}
                    sequence={preview}
                  />
                ) : null)}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
