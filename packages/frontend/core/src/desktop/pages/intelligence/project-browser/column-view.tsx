import { ProjectResourceKind } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { type ReactNode, useEffect, useRef } from 'react';

import { ProjectFolderDropTarget } from '../project-file-drop-target';
import { type ProjectFile, useProjectFolder } from '../project-files-data';
import { ProjectResourceIcon } from '../project-resource-icon';
import * as styles from './browser.css';
import type { FileChange } from './file-actions';
import { BrowserItem } from './item';
import { type FolderQuery, folderReady, FolderState, LoadMore } from './shared';
import { type BrowserSort, sortProjectFiles } from './use-browser-state';

function ColumnList({
  index,
  query,
  sort,
  openId,
  trash,
}: {
  index: number;
  query: FolderQuery;
  sort: BrowserSort;
  openId: string | null;
  trash: boolean;
}) {
  const t = useI18n();
  return (
    <>
      <FolderState query={query} />
      {folderReady(query) ? (
        <div
          role="listbox"
          aria-multiselectable
          aria-label={`${t['com.affine.localmind.project-browser.view.columns']()} ${index + 1}`}
          data-browser-column={index}
        >
          {sortProjectFiles(query.items, sort).map(file => (
            <BrowserItem
              key={file.id}
              file={file}
              siblings={query.items}
              className={styles.columnRow}
              open={file.id === openId}
            >
              <ProjectResourceIcon kind={file.kind} title={file.title} />
              <span className={styles.label}>{file.title}</span>
              {file.kind === ProjectResourceKind.folder && !trash ? (
                <ArrowRightSmallIcon className={styles.columnChevron} />
              ) : null}
            </BrowserItem>
          ))}
        </div>
      ) : null}
      <LoadMore query={query} />
    </>
  );
}

function FolderColumn({
  projectId,
  parentId,
  ...props
}: {
  projectId: string;
  parentId: string | null;
  index: number;
  sort: BrowserSort;
  openId: string | null;
  trash: boolean;
  onMove: (file: ProjectFile, change: FileChange) => void;
}) {
  const query = useProjectFolder({ projectId, parentId });
  return (
    <div className={styles.column}>
      <ProjectFolderDropTarget
        projectId={projectId}
        parentId={parentId}
        trash={false}
        onMove={props.onMove}
      >
        <ColumnList {...props} query={query} />
      </ProjectFolderDropTarget>
    </div>
  );
}

/**
 * Miller columns: one column per folder from the project root down to the
 * current folder, followed by a preview of the selected file.
 */
export function ColumnView({
  projectId,
  path,
  currentQuery,
  sort,
  trash,
  onMove,
  preview,
}: {
  projectId: string;
  /** Folders from the root down to the current folder (inclusive). */
  path: readonly ProjectFile[];
  currentQuery: FolderQuery;
  sort: BrowserSort;
  trash: boolean;
  onMove: (file: ProjectFile, change: FileChange) => void;
  preview: ReactNode;
}) {
  // Every folder from the root down to the current one gets a column; the
  // current folder's column is rendered last from the shared folder query.
  const parents: (string | null)[] = trash
    ? []
    : [null, ...path.map(folder => folder.id)].slice(0, -1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasPreview = !!preview;
  // Keep the deepest column (and the preview) in view, like Finder.
  useEffect(() => {
    const element = scrollRef.current;
    element?.scrollTo?.({ left: element.scrollWidth, behavior: 'smooth' });
  }, [parents.length, hasPreview]);
  return (
    <div ref={scrollRef} className={styles.columns} data-browser-view="columns">
      {parents.map((parentId, index) => (
        <FolderColumn
          key={parentId ?? 'root'}
          projectId={projectId}
          parentId={parentId}
          index={index}
          sort={sort}
          openId={path[index]?.id ?? null}
          trash={false}
          onMove={onMove}
        />
      ))}
      <div className={styles.column}>
        <ProjectFolderDropTarget
          projectId={projectId}
          parentId={trash ? null : (path.at(-1)?.id ?? null)}
          trash={trash}
          onMove={onMove}
        >
          <ColumnList
            index={parents.length}
            query={currentQuery}
            sort={sort}
            openId={null}
            trash={trash}
          />
        </ProjectFolderDropTarget>
      </div>
      {preview ? <div className={styles.previewColumn}>{preview}</div> : null}
    </div>
  );
}
