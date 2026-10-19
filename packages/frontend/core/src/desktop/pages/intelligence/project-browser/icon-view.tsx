import { useI18n } from '@affine/i18n';

import type { ProjectFile } from '../project-files-data';
import { ProjectResourceIcon } from '../project-resource-icon';
import * as styles from './browser.css';
import { BrowserItem } from './item';
import { type FolderQuery, folderReady, FolderState, LoadMore } from './shared';

export function IconView({
  query,
  files,
}: {
  query: FolderQuery;
  files: readonly ProjectFile[];
}) {
  const t = useI18n();
  return (
    <>
      <FolderState query={query} />
      {folderReady(query) ? (
        <div
          role="listbox"
          aria-multiselectable
          aria-label={t['com.affine.localmind.project-browser.view.icons']()}
          aria-orientation="horizontal"
          className={styles.iconGrid}
          data-browser-view="icons"
        >
          {files.map(file => (
            <BrowserItem
              key={file.id}
              file={file}
              siblings={query.items}
              className={styles.tile}
            >
              <span
                className={styles.tileIcon}
                data-folder={file.kind === 'folder'}
              >
                <ProjectResourceIcon kind={file.kind} title={file.title} />
              </span>
              <span className={styles.tileLabel}>{file.title}</span>
            </BrowserItem>
          ))}
        </div>
      ) : null}
      <LoadMore query={query} />
    </>
  );
}
