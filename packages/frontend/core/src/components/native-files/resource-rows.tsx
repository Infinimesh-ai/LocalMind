import { MenuItem, Tooltip, useDraggable } from '@affine/component';
import { useGuard } from '@affine/core/components/guard';
import { DocsService } from '@affine/core/modules/doc';
import { DocDisplayMetaService } from '@affine/core/modules/doc-display-meta';
import { TagService } from '@affine/core/modules/tag';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { type NativeResource } from '@affine/core/modules/workspace-resources';
import type { AffineDNDData } from '@affine/core/types/dnd';
import { resourceDate, type WorkspaceDocumentType } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import {
  AttachmentIcon,
  EdgelessIcon,
  ExportToPdfIcon,
  FileIcon,
  FolderIcon,
  HeadphonePanelIcon,
  ImageIcon,
  PageIcon,
  PlayPanelIcon,
  TableIcon,
  TagsIcon,
  TextIcon,
  ViewIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useContext, useRef, useState } from 'react';

import { DocExplorerContext } from '../explorer/context';
import { MoreMenuButton } from '../explorer/docs-view/more-menu';
import { quickActions } from '../explorer/quick-actions.constants';
import { defaultResourceProperties } from '../explorer/resource-preferences';
import { PagePreview } from '../page-list/page-content-preview';
import {
  ResourceInlineTags,
  ResourceMetadata,
  ResourceTags,
} from './resource-metadata';
import * as metadataStyles from './resource-metadata.css';
import { ResourceRowShell } from './resource-row-shell';
import { ResourceSelectionModeContext } from './resource-selection-context';
import { ResourceTagDialog } from './resource-tag-dialog';

const icons = {
  folder: FolderIcon,
  page: PageIcon,
  edgeless: EdgelessIcon,
  docx: FileIcon,
  xlsx: TableIcon,
  pptx: ViewIcon,
  pdf: ExportToPdfIcon,
  txt: TextIcon,
  markdown: TextIcon,
  csv: TableIcon,
  json: TextIcon,
  image: ImageIcon,
  audio: HeadphonePanelIcon,
  video: PlayPanelIcon,
  other: AttachmentIcon,
};
export function ResourceTypeIcon({ type }: { type: WorkspaceDocumentType }) {
  const Icon = icons[type];
  const t = useI18n();
  const label = t[`com.affine.localmind.resource-display.type.${type}`]();
  return (
    <Tooltip content={label}>
      <span className={metadataStyles.typeIcon} role="img" aria-label={label}>
        <Icon />
      </span>
    </Tooltip>
  );
}

export { ResourceRowShell } from './resource-row-shell';
export function NativeTags({ resource }: { resource: NativeResource }) {
  const compact = useLiveData(useContext(DocExplorerContext).view$) === 'list';
  return (
    <ResourceTags
      tags={resource.tags}
      hideEmpty={compact}
      limit={compact ? 1 : 2}
    />
  );
}

/**
 * Rendered only while the row menu is open, so list rows hold no permission
 * subscription; the open menu checks the live `Doc_Update` grant.
 */
function EditTagsMenuItem({
  docId,
  onSelect,
}: {
  docId: string;
  onSelect: () => void;
}) {
  const t = useI18n();
  const canEdit = useGuard('Doc_Update', docId);
  return (
    <MenuItem
      prefixIcon={<TagsIcon />}
      disabled={canEdit !== true}
      onSelect={onSelect}
      data-testid="resource-edit-tags"
    >
      {t['com.affine.localmind.resources.editTags']()}
    </MenuItem>
  );
}

export function MixedDocRow({ id }: { id: string }) {
  const doc = useLiveData(useService(DocsService).list.doc$(id));
  const meta = useLiveData(doc?.meta$);
  const createdBy = useLiveData(doc?.createdBy$);
  const event = useLiveData(doc?.displayUpdate$);
  const mode = useLiveData(doc?.primaryMode$);
  const preference = useLiveData(
    useContext(DocExplorerContext).displayPreference$
  );
  const workbench = useService(WorkbenchService).workbench;
  const contextSelectMode = !!useLiveData(
    useContext(DocExplorerContext).selectMode$
  );
  const explicitSelection = useContext(ResourceSelectionModeContext);
  const selectMode = explicitSelection && contextSelectMode;
  const tags = useLiveData(useService(TagService).tagList.tagMetas$);
  const [editingTags, setEditingTags] = useState(false);
  const operationRef = useRef<HTMLButtonElement>(null);
  const t = useI18n();
  const display = useService(DocDisplayMetaService);
  const title = useLiveData(display.title$(id));
  const { dragRef, CustomDragPreview } = useDraggable<AffineDNDData>(
    () => ({
      canDrag: !selectMode && !!preference.showDragHandle,
      data: { entity: { type: 'doc', id }, from: { at: 'all-docs:list' } },
    }),
    [id, preference.showDragHandle, selectMode]
  );
  if (!doc) return null;
  const tagIds = (meta?.tags ?? []).filter(id =>
    tags.some(tag => tag.id === id)
  );
  const tagEditor = (
    <ResourceTags
      tags={tags.filter(tag => tagIds.includes(tag.id))}
      hideEmpty={preference.view === 'list'}
      limit={preference.view === 'list' ? 1 : 2}
    />
  );
  return (
    <div
      ref={dragRef}
      style={{ height: '100%' }}
      data-testid="doc-list-item"
      data-doc-id={id}
    >
      <ResourceRowShell
        id={id}
        title={title}
        icon={
          <ResourceTypeIcon type={mode === 'edgeless' ? 'edgeless' : 'page'} />
        }
        onOpen={() => workbench.openDoc(id)}
        preview={<PagePreview pageId={id} />}
        tags={
          <ResourceInlineTags empty={!tagIds.length}>
            {tagEditor}
          </ResourceInlineTags>
        }
        actions={
          <>
            {quickActions
              .filter(action => action.key !== 'quickSelect')
              .map(({ key, Component }) => (
                <Component key={key} doc={doc} />
              ))}
            <MoreMenuButton
              triggerRef={operationRef}
              docId={id}
              iconProps={{
                'data-resource-operation': 'true',
                'aria-label': `${t['com.affine.localmind.resources.actions']()}: ${title}`,
              }}
              additionalItems={
                <EditTagsMenuItem
                  docId={id}
                  onSelect={() => setEditingTags(true)}
                />
              }
            />
          </>
        }
      >
        <ResourceMetadata
          properties={
            preference.resourceProperties ?? defaultResourceProperties
          }
          tags={tags.filter(tag => tagIds.includes(tag.id))}
          tagEditor={tagEditor}
          createdAt={resourceDate(meta?.createDate)}
          createdBy={createdBy}
          updatedAt={event?.at ?? resourceDate(meta?.updatedDate)}
          updatedBy={event?.by}
          updateActor={event?.actor ?? 'unknown'}
          documentType={mode === 'edgeless' ? 'edgeless' : 'page'}
        />
      </ResourceRowShell>
      {editingTags && (
        <ResourceTagDialog
          returnFocus={operationRef}
          mode="edit"
          targets={[{ key: id, id, kind: 'doc', title }]}
          onClose={() => setEditingTags(false)}
        />
      )}
      <CustomDragPreview>{title}</CustomDragPreview>
    </div>
  );
}
