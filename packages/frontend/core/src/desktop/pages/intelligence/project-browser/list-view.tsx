import { Loading } from '@affine/component';
import { ProjectResourceKind } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  ArrowRightSmallIcon,
  SortDownIcon,
  SortUpIcon,
} from '@blocksuite/icons/rc';
import { useState } from 'react';

import { type ProjectFile, useProjectFolder } from '../project-files-data';
import { ProjectResourceIcon } from '../project-resource-icon';
import * as styles from './browser.css';
import { BrowserItem } from './item';
import {
  type FolderQuery,
  folderReady,
  FolderState,
  formatResourceDate,
  LoadMore,
  useKindLabel,
} from './shared';
import {
  type BrowserSort,
  type BrowserSortKey,
  sortProjectFiles,
} from './use-browser-state';

type RowsProps = {
  files: readonly ProjectFile[];
  siblings: readonly ProjectFile[];
  level: number;
  sort: BrowserSort;
  trash: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
};

function Rows({
  files,
  siblings,
  level,
  sort,
  trash,
  expanded,
  onToggle,
}: RowsProps) {
  const kindLabel = useKindLabel();
  return (
    <>
      {files.map(file => {
        const folder = file.kind === ProjectResourceKind.folder && !trash;
        const open = folder && expanded.has(file.id);
        return (
          <div key={file.id} role="presentation">
            <BrowserItem
              file={file}
              siblings={siblings}
              className={styles.listRow}
              level={level + 1}
              expanded={folder ? open : undefined}
            >
              <span
                className={styles.nameCell}
                style={{ paddingInlineStart: 6 + level * 18 }}
              >
                {folder ? (
                  <button
                    type="button"
                    className={styles.disclosure}
                    aria-expanded={open}
                    aria-label={file.title}
                    tabIndex={-1}
                    onClick={event => {
                      event.stopPropagation();
                      onToggle(file.id);
                    }}
                    onDoubleClick={event => event.stopPropagation()}
                  >
                    <ArrowRightSmallIcon />
                  </button>
                ) : (
                  <span className={styles.disclosureSpacer} />
                )}
                <ProjectResourceIcon kind={file.kind} title={file.title} />
                <span className={styles.label}>{file.title}</span>
              </span>
              <span className={styles.listCell}>{kindLabel(file.kind)}</span>
              <span className={styles.listCell}>
                {formatResourceDate(file.updatedAt)}
              </span>
            </BrowserItem>
            {open ? (
              <Branch
                projectId={file.projectId}
                parentId={file.id}
                level={level + 1}
                sort={sort}
                trash={trash}
                expanded={expanded}
                onToggle={onToggle}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function Branch({
  projectId,
  parentId,
  ...props
}: Omit<RowsProps, 'files' | 'siblings'> & {
  projectId: string;
  parentId: string;
}) {
  const query = useProjectFolder({ projectId, parentId });
  if (query.isLoading && !query.error)
    return (
      <div
        className={styles.state}
        role="status"
        style={{ padding: '4px 0', alignItems: 'flex-start' }}
      >
        <Loading size={14} />
      </div>
    );
  if (query.error || !query.items.length)
    return (
      <div style={{ paddingInlineStart: 40 + props.level * 18 }}>
        <FolderState query={query} />
      </div>
    );
  return (
    <>
      <Rows
        {...props}
        files={sortProjectFiles(query.items, props.sort)}
        siblings={query.items}
      />
      <LoadMore query={query} />
    </>
  );
}

export function ListView({
  query,
  files,
  sort,
  onSortChange,
  trash,
}: {
  query: FolderQuery;
  files: readonly ProjectFile[];
  sort: BrowserSort;
  onSortChange: (sort: BrowserSort) => void;
  trash: boolean;
}) {
  const t = useI18n();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const header = (key: Exclude<BrowserSortKey, 'manual'>) => {
    const active = sort.key === key;
    return (
      <button
        type="button"
        role="columnheader"
        className={styles.listHeaderCell}
        aria-sort={
          active
            ? sort.direction === 'asc'
              ? 'ascending'
              : 'descending'
            : 'none'
        }
        onClick={() =>
          onSortChange({
            key,
            direction: active && sort.direction === 'asc' ? 'desc' : 'asc',
          })
        }
      >
        {t[`com.affine.localmind.project-browser.sort.${key}`]()}
        {active ? (
          sort.direction === 'asc' ? (
            <SortUpIcon />
          ) : (
            <SortDownIcon />
          )
        ) : null}
      </button>
    );
  };
  return (
    <>
      <div className={styles.listHeader} role="row">
        {header('name')}
        {header('kind')}
        {header('modified')}
      </div>
      <FolderState query={query} />
      {folderReady(query) ? (
        <div
          role="listbox"
          aria-multiselectable
          aria-label={t['com.affine.localmind.project-browser.view.list']()}
          className={styles.listBody}
          data-browser-view="list"
        >
          <Rows
            files={files}
            siblings={query.items}
            level={0}
            sort={sort}
            trash={trash}
            expanded={expanded}
            onToggle={id =>
              setExpanded(current => {
                const next = new Set(current);
                if (!next.delete(id)) next.add(id);
                return next;
              })
            }
          />
        </div>
      ) : null}
      <LoadMore query={query} />
    </>
  );
}
