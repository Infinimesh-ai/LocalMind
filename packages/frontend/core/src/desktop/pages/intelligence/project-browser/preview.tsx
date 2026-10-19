import { Button } from '@affine/component';
import { ProjectResourceKind } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { FolderIcon } from '@blocksuite/icons/rc';

import type { ProjectFile } from '../project-files-data';
import { ProjectResourcePreview } from '../project-resource-preview';
import * as styles from './browser.css';
import { formatResourceDate, useKindLabel } from './shared';

const ignoreOfficeContext = () => {};

export function FileMeta({ file }: { file: ProjectFile }) {
  const t = useI18n();
  const kindLabel = useKindLabel();
  return (
    <dl className={styles.meta}>
      <dt>{t['com.affine.localmind.project-browser.sort.kind']()}</dt>
      <dd>{kindLabel(file.kind)}</dd>
      <dt>{t['com.affine.localmind.project-browser.sort.modified']()}</dt>
      <dd>{formatResourceDate(file.updatedAt)}</dd>
      <dt>{t['com.affine.localmind.project-browser.meta.created']()}</dt>
      <dd>{formatResourceDate(file.createdAt)}</dd>
    </dl>
  );
}

/**
 * Inline preview of the selected item, built on the workbench resource
 * preview. Folders and trashed items show their metadata only.
 */
export function PreviewPane({
  projectId,
  file,
  trash,
  onOpen,
  onClose,
}: {
  projectId: string;
  file: ProjectFile | null;
  trash: boolean;
  onOpen: (file: ProjectFile) => void;
  onClose: () => void;
}) {
  const t = useI18n();
  if (!file)
    return (
      <div className={styles.state}>
        {t['com.affine.localmind.project-browser.preview.select']()}
      </div>
    );
  if (file.kind === ProjectResourceKind.folder || trash)
    return (
      <div className={styles.previewPane} data-testid="browser-item-summary">
        <div className={styles.folderSummary}>
          {file.kind === ProjectResourceKind.folder ? <FolderIcon /> : null}
          <strong>{file.title}</strong>
          {!trash ? (
            <Button onClick={() => onOpen(file)}>
              {t['com.affine.localmind.project-files.open']()}
            </Button>
          ) : null}
        </div>
        <FileMeta file={file} />
      </div>
    );
  return (
    <div className={styles.previewPane}>
      <FileMeta file={file} />
      <div className={styles.previewFrame}>
        <ProjectResourcePreview
          key={`${projectId}:${file.id}`}
          projectId={projectId}
          resourceId={file.id}
          fullscreen={false}
          onToggleFullscreen={() => onOpen(file)}
          onOfficeContextChange={ignoreOfficeContext}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
