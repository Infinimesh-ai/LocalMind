import { useI18n } from '@affine/i18n';
import type { ReactNode } from 'react';

import type { ProjectFile } from '../project-files-data';
import { ProjectResourceIcon } from '../project-resource-icon';
import * as styles from './browser.css';
import { BrowserItem } from './item';
import { type FolderQuery, folderReady, FolderState, LoadMore } from './shared';

/** Large preview of the selected item over a strip of thumbnails. */
export function GalleryView({
  query,
  files,
  preview,
}: {
  query: FolderQuery;
  files: readonly ProjectFile[];
  preview: ReactNode;
}) {
  const t = useI18n();
  if (!folderReady(query))
    return (
      <>
        <FolderState query={query} />
        <LoadMore query={query} />
      </>
    );
  return (
    <div className={styles.gallery} data-browser-view="gallery">
      <div className={styles.galleryStage}>{preview}</div>
      <div
        role="listbox"
        aria-multiselectable
        aria-orientation="horizontal"
        aria-label={t['com.affine.localmind.project-browser.view.gallery']()}
        className={styles.galleryStrip}
      >
        {files.map(file => (
          <BrowserItem
            key={file.id}
            file={file}
            siblings={query.items}
            className={styles.galleryThumb}
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
        <LoadMore query={query} />
      </div>
    </div>
  );
}
