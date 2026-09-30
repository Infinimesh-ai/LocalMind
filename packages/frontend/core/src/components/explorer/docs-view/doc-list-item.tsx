import {
  Checkbox,
  ContextMenu,
  DragHandle as DragHandleIcon,
  Tooltip,
  useDraggable,
} from '@affine/component';
import { DocsService } from '@affine/core/modules/doc';
import { DocDisplayMetaService } from '@affine/core/modules/doc-display-meta';
import { WorkbenchLink } from '@affine/core/modules/workbench';
import type { AffineDNDData } from '@affine/core/types/dnd';
import { useI18n } from '@affine/i18n';
import track from '@affine/track';
import {
  AutoTidyUpIcon,
  PropertyIcon,
  ResizeTidyUpIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import {
  type HTMLProps,
  memo,
  type ReactNode,
  type SVGProps,
  useCallback,
  useContext,
} from 'react';

import { PagePreview } from '../../page-list/page-content-preview';
import { DocExplorerContext, type DocExplorerContextType } from '../context';
import { quickActions } from '../quick-actions.constants';
import * as styles from './doc-list-item.css';
import { MoreMenuButton, MoreMenuContent } from './more-menu';
import { CardViewProperties, ListViewProperties } from './properties';

export type DocListItemView = 'list' | 'grid' | 'masonry';

export const DocListViewIcon = ({
  view,
  ...props
}: { view: DocListItemView } & SVGProps<SVGSVGElement>) => {
  const Component = {
    list: PropertyIcon,
    grid: ResizeTidyUpIcon,
    masonry: AutoTidyUpIcon,
  }[view];

  return <Component {...props} />;
};

export interface DocListItemProps {
  docId: string;
  groupId: string;
}

class MixId {
  static connector = '||';
  static create(groupId: string, docId: string) {
    return `${groupId}${this.connector}${docId}`;
  }
  static parse(mixId: string) {
    if (!mixId) {
      return { groupId: null, docId: null };
    }
    const [groupId, docId] = mixId.split(this.connector);
    return { groupId, docId };
  }
}
function selectDoc(
  context: DocExplorerContextType,
  docId: string,
  groupId: string,
  shiftKey: boolean
) {
  const cursor = MixId.create(groupId, docId);
  const anchor = context.prevCheckAnchorId$?.value;
  const selected = new Set(context.selectedDocIds$.value);
  const list = context.groups$.value.flatMap(group =>
    group.items.map(id => MixId.create(group.key, id))
  );
  const from = anchor ? list.indexOf(anchor) : -1;
  const to = list.indexOf(cursor);
  if (shiftKey && from >= 0 && to >= 0) {
    const handled = new Set<string>();
    for (const item of list.slice(Math.min(from, to), Math.max(from, to) + 1)) {
      const { docId: id } = MixId.parse(item);
      if (!id || item === anchor || handled.has(id)) continue;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      handled.add(id);
    }
  } else if (selected.has(docId)) selected.delete(docId);
  else selected.add(docId);
  context.selectMode$?.next(true);
  context.selectedDocIds$.next([...selected]);
  context.prevCheckAnchorId$?.next(cursor);
}

export const DocListItem = ({ ...props }: DocListItemProps) => {
  const contextValue = useContext(DocExplorerContext);
  const view = useLiveData(contextValue.view$) ?? 'list';
  const selectMode = useLiveData(contextValue.selectMode$);
  const selectedDocIds = useLiveData(contextValue.selectedDocIds$);

  const handleClick = useCallback(
    (e: React.MouseEvent<Element>) => {
      const { docId, groupId } = props;
      if (selectMode || e.shiftKey) {
        e.preventDefault();
        selectDoc(contextValue, docId, groupId, e.shiftKey);
      } else {
        track.allDocs.list.doc.openDoc();
      }
    },
    [contextValue, props, selectMode]
  );

  const { dragRef, CustomDragPreview } = useDraggable<AffineDNDData>(
    () => ({
      canDrag: true,
      data: {
        entity: {
          type: 'doc',
          id: props.docId as string,
        },
        from: {
          at: 'all-docs:list',
        },
      },
    }),
    [props.docId]
  );

  return (
    <>
      <WorkbenchLink
        ref={dragRef}
        draggable={false}
        to={`/${props.docId}`}
        onClick={handleClick}
        data-selected={selectedDocIds.includes(props.docId)}
        className={styles.root}
        data-testid={`doc-list-item`}
        data-doc-id={props.docId}
      >
        {view === 'list' ? (
          <ListViewDoc {...props} />
        ) : (
          <CardViewDoc {...props} />
        )}
      </WorkbenchLink>
      <CustomDragPreview>
        <div className={styles.dragPreview}>
          <RawDocIcon id={props.docId} className={styles.dragPreviewIcon} />
          <RawDocTitle id={props.docId} />
        </div>
      </CustomDragPreview>
    </>
  );
};

const RawDocIcon = memo(function RawDocIcon({
  id,
  ...props
}: HTMLProps<SVGSVGElement>) {
  const docDisplayMetaService = useService(DocDisplayMetaService);
  const Icon = useLiveData(id ? docDisplayMetaService.icon$(id) : null);
  return <Icon {...props} />;
});
const RawDocTitle = memo(function RawDocTitle({ id }: { id: string }) {
  const docDisplayMetaService = useService(DocDisplayMetaService);
  const title = useLiveData(docDisplayMetaService.title$(id));
  return title;
});
const RawDocPreview = memo(function RawDocPreview({
  id,
  loading,
}: {
  id: string;
  loading?: ReactNode;
}) {
  return <PagePreview pageId={id} fallback={loading} />;
});
const DragHandle = memo(function DragHandle({
  id,
  ...props
}: HTMLProps<HTMLDivElement>) {
  const contextValue = useContext(DocExplorerContext);
  const selectMode = useLiveData(contextValue.selectMode$);
  const showDragHandle = useLiveData(contextValue.showDragHandle$);

  if (selectMode || !id || !showDragHandle) {
    return null;
  }

  return (
    <div {...props}>
      <DragHandleIcon />
    </div>
  );
});
const Select = memo(function Select({
  id,
  groupId,
  ...props
}: HTMLProps<HTMLDivElement> & { groupId: string }) {
  const contextValue = useContext(DocExplorerContext);
  const selectMode = useLiveData(contextValue.selectMode$);
  const selectedDocIds = useLiveData(contextValue.selectedDocIds$);

  if (!id) {
    return null;
  }

  return (
    <div
      data-select-mode={selectMode}
      data-testid={`doc-list-item-select`}
      {...props}
    >
      <Checkbox
        checked={selectedDocIds.includes(id)}
        onClick={event => {
          event.stopPropagation();
          // Keep the native input toggle; icon clicks must not follow the row link.
          if (!(event.target instanceof HTMLInputElement))
            event.preventDefault();
          selectDoc(contextValue, id, groupId, event.shiftKey);
        }}
      />
    </div>
  );
});
// Different with RawDocIcon, refer to `ExplorerDisplayPreference.showDocIcon`
const DocIcon = memo(function DocIcon({
  id,
  ...props
}: HTMLProps<HTMLDivElement>) {
  const contextValue = useContext(DocExplorerContext);
  const showDocIcon = useLiveData(contextValue.showDocIcon$);
  if (!showDocIcon) {
    return null;
  }
  return (
    <div {...props}>
      <RawDocIcon id={id} />
    </div>
  );
});
const DocTitle = memo(function DocTitle({
  id,
  ...props
}: HTMLProps<HTMLDivElement>) {
  if (!id) return null;
  return (
    <div {...props}>
      <RawDocTitle id={id} />
    </div>
  );
});
const DocPreview = memo(function DocPreview({
  id,
  loading,
  ...props
}: HTMLProps<HTMLDivElement> & { loading?: ReactNode }) {
  const contextValue = useContext(DocExplorerContext);
  const showDocPreview = useLiveData(contextValue.showDocPreview$);

  if (!id || !showDocPreview) return null;

  return (
    <div {...props}>
      <RawDocPreview id={id} loading={loading} />
    </div>
  );
});

const listMoreMenuContentOptions = {
  side: 'bottom',
  align: 'end',
  sideOffset: 12,
  alignOffset: -4,
} as const;
export const ListViewDoc = ({ docId, groupId }: DocListItemProps) => {
  const t = useI18n();
  const docsService = useService(DocsService);
  const doc = useLiveData(docsService.list.doc$(docId));
  const contextValue = useContext(DocExplorerContext);
  const showMoreOperation = useLiveData(contextValue.showMoreOperation$);

  if (!doc) {
    return null;
  }

  return (
    <ContextMenu
      asChild
      disabled={!showMoreOperation}
      items={<MoreMenuContent docId={docId} />}
    >
      <li className={styles.listViewRoot}>
        <DragHandle id={docId} className={styles.listDragHandle} />
        <Select id={docId} groupId={groupId} className={styles.listSelect} />
        <DocIcon id={docId} className={styles.listIcon} />
        <div className={styles.listBrief}>
          <DocTitle
            id={docId}
            className={styles.listTitle}
            data-testid="doc-list-item-title"
          />
          <DocPreview id={docId} className={styles.listPreview} />
        </div>
        <div className={styles.listSpace} />
        <ListViewProperties docId={docId} />
        {quickActions.map(action => {
          return (
            <Tooltip key={action.key} content={t.t(action.name)}>
              <action.Component doc={doc} />
            </Tooltip>
          );
        })}
        <MoreMenuButton
          docId={docId}
          contentOptions={listMoreMenuContentOptions}
        />
      </li>
    </ContextMenu>
  );
};

const cardMoreMenuContentOptions = {
  side: 'bottom',
  align: 'end',
  sideOffset: 12,
  alignOffset: -4,
} as const;

export const CardViewDoc = ({ docId, groupId }: DocListItemProps) => {
  const t = useI18n();
  const contextValue = useContext(DocExplorerContext);
  const selectMode = useLiveData(contextValue.selectMode$);
  const docsService = useService(DocsService);
  const doc = useLiveData(docsService.list.doc$(docId));
  const showMoreOperation = useLiveData(contextValue.showMoreOperation$);

  if (!doc) {
    return null;
  }

  return (
    <ContextMenu
      asChild
      disabled={!showMoreOperation}
      items={<MoreMenuContent docId={docId} />}
    >
      <li className={styles.cardViewRoot}>
        <DragHandle id={docId} className={styles.cardDragHandle} />
        <header className={styles.cardViewHeader}>
          <DocIcon id={docId} className={styles.cardViewIcon} />
          <DocTitle
            id={docId}
            className={styles.cardViewTitle}
            data-testid="doc-list-item-title"
          />
          {quickActions.map(action => {
            return (
              <Tooltip key={action.key} content={t.t(action.name)}>
                <action.Component size="16" doc={doc} />
              </Tooltip>
            );
          })}
          {selectMode ? (
            <Select
              id={docId}
              groupId={groupId}
              className={styles.cardViewCheckbox}
            />
          ) : (
            <MoreMenuButton
              docId={docId}
              contentOptions={cardMoreMenuContentOptions}
              iconProps={{ size: '16' }}
            />
          )}
        </header>
        <DocPreview id={docId} className={styles.cardPreviewContainer} />
        <CardViewProperties docId={docId} />
      </li>
    </ContextMenu>
  );
};
