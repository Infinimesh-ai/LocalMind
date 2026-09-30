import { Button, Input, Modal } from '@affine/component';
import { GraphQLService } from '@affine/core/modules/cloud';
import {
  createProjectNativeFileMutation,
  createWorkspaceNativeResourceMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import type { NativeFileContent } from '@localmind/office';
import { useService } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { useRef, useState } from 'react';

import * as styles from './native-files.css';

const formats = ['docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'json'] as const;
export type NativeFileFormat = (typeof formats)[number];
type Format = NativeFileFormat;
export function blankNativeContent(format: Format): NativeFileContent {
  switch (format) {
    case 'docx':
      return { format, paragraphs: [{ text: '' }] };
    case 'xlsx':
      return { format, sheets: [{ name: 'Sheet1', rows: [] }] };
    case 'pptx':
      return { format, slides: [{ title: '', paragraphs: [] }] };
    case 'csv':
      return { format, rows: [] };
    case 'json':
      return { format, text: '{}' };
    default:
      return { format, text: '' };
  }
}

export function NativeFileCreateDialog({
  owner,
  parentId,
  initialFormat,
  onClose,
  onCreated,
}: {
  owner: { workspaceId: string } | { projectId: string };
  parentId?: string | null;
  initialFormat?: NativeFileFormat;
  onClose: () => void;
  onCreated: (id: string, kind: 'file' | 'office') => void;
}) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<Format>(initialFormat ?? 'docx');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState(false);
  const request = useRef<{
    title: string;
    format: Format;
    requestKey: string;
  } | null>(null);
  const submit = async () => {
    if (pendingRef.current || !title.trim()) return;
    pendingRef.current = true;
    request.current ??= { title: title.trim(), format, requestKey: nanoid() };
    const frozen = request.current;
    setPending(true);
    setError(false);
    try {
      const content = blankNativeContent(frozen.format);
      const id =
        'workspaceId' in owner
          ? (
              await graphql.gql({
                query: createWorkspaceNativeResourceMutation,
                variables: {
                  input: {
                    ...owner,
                    title: frozen.title,
                    requestKey: frozen.requestKey,
                    folderId: parentId,
                    content,
                  },
                },
              })
            ).createWorkspaceNativeResource.id
          : (
              await graphql.gql({
                query: createProjectNativeFileMutation,
                variables: {
                  input: {
                    ...owner,
                    title: frozen.title,
                    requestKey: frozen.requestKey,
                    parentId,
                    content,
                  },
                },
              })
            ).createProjectNativeFile.id;
      onCreated(
        id,
        ['docx', 'xlsx', 'pptx'].includes(frozen.format) ? 'office' : 'file'
      );
      onClose();
    } catch {
      setError(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={open => {
        if (!open && !pending) onClose();
      }}
      title={t['com.affine.localmind.native-files.newFile']()}
    >
      <form
        className={styles.form}
        // Portals still bubble through the tree row, which cancels link clicks.
        onClick={event => event.stopPropagation()}
        onSubmit={event => {
          event.preventDefault();
          event.stopPropagation();
          void submit().catch(() => setError(true));
        }}
      >
        <label>
          {t['com.affine.localmind.native-files.name']()}
          <Input
            autoFocus
            value={title}
            onChange={setTitle}
            onKeyDown={event => {
              if (
                event.key === 'Enter' &&
                (event.nativeEvent.isComposing || event.keyCode === 229)
              ) {
                event.preventDefault();
              }
            }}
            disabled={pending || !!request.current}
          />
        </label>
        {!initialFormat && (
          <label>
            {t['com.affine.localmind.native-files.format']()}
            <select
              value={format}
              onChange={event => setFormat(event.target.value as Format)}
              disabled={pending || !!request.current}
            >
              {formats.map(value => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p role="alert">
            {t['com.affine.localmind.native-files.retrySameRequest']()}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="button" disabled={pending} onClick={onClose}>
            {t['Cancel']()}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !title.trim()}
          >
            {pending
              ? t['Loading']()
              : error
                ? t['com.affine.error.retry']()
                : t['com.affine.localmind.project-files.create']()}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
