import { Button, useDraggable } from '@affine/component';
import {
  GraphQLService,
  WorkspaceServerService,
} from '@affine/core/modules/cloud';
import { DocsService } from '@affine/core/modules/doc';
import { DocDisplayMetaService } from '@affine/core/modules/doc-display-meta';
import { GuardService } from '@affine/core/modules/permissions';
import { TagService } from '@affine/core/modules/tag';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import {
  type NativeResource,
  WorkspaceResourcesService,
} from '@affine/core/modules/workspace-resources';
import type { AffineDNDData } from '@affine/core/types/dnd';
import { UserFriendlyError } from '@affine/error';
import {
  resourceDate,
  setWorkspaceNativeResourceTagsMutation,
  type WorkspaceDocumentType,
} from '@affine/graphql';
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
  TextIcon,
  ViewIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { nanoid } from 'nanoid';
import { useContext, useEffect, useRef, useState } from 'react';

import { DocExplorerContext } from '../explorer/context';
import { MoreMenuButton } from '../explorer/docs-view/more-menu';
import { quickActions } from '../explorer/quick-actions.constants';
import { defaultResourceProperties } from '../explorer/resource-preferences';
import { PagePreview } from '../page-list/page-content-preview';
import { WorkspaceTagsInlineEditor } from '../tags';
import { ResourceMetadata, ResourceTags } from './resource-metadata';
import { ResourceRowShell } from './resource-row-shell';

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
  return <Icon />;
}

export { ResourceRowShell } from './resource-row-shell';
export function NativeTags({ resource }: { resource: NativeResource }) {
  const graphql = useService(GraphQLService);
  const { workspace } = useService(WorkspaceService);
  const { server } = useService(WorkspaceServerService);
  const service = useService(WorkspaceResourcesService);
  const tags = useLiveData(useService(TagService).tagList.tagMetas$);
  const t = useI18n();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<
    | { tagIds: string[]; requestKey: string; expectedVersion: number }
    | undefined
  >(undefined);
  const busy = useRef(false);
  const scope = useRef<string | undefined>(undefined);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const selected = resource.tags
    .map(tag => tag.id)
    .filter(id => tags.some(tag => tag.id === id));
  const save = async (ids?: string[]) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    if (ids) {
      scope.current = server?.account$.value?.id;
      request.current = {
        tagIds: ids,
        requestKey: nanoid(),
        expectedVersion: resource.metadataVersion,
      };
    }
    try {
      if (!request.current) return;
      await workspace.engine.doc.waitForSynced(workspace.id);
      if (!active.current || scope.current !== server?.account$.value?.id) {
        request.current = undefined;
        return;
      }
      await graphql.gql({
        query: setWorkspaceNativeResourceTagsMutation,
        variables: {
          input: {
            ...request.current,
            workspaceId: resource.workspaceId,
            kind: resource.kind,
            resourceId: resource.id,
          },
        },
      });
      request.current = undefined;
      if (!active.current || scope.current !== server?.account$.value?.id)
        return;
      await service.refresh();
    } catch (error) {
      if (
        [400, 403, 404, 409].includes(UserFriendlyError.fromAny(error).status)
      ) {
        request.current = undefined;
        service.invalidate(true);
      }
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  if (!resource.canEditTags)
    return (
      <ResourceTags tags={tags.filter(tag => selected.includes(tag.id))} />
    );
  return (
    <div aria-busy={pending}>
      <WorkspaceTagsInlineEditor
        tagMode="inline-tag"
        renderSelectedTags={tags => <ResourceTags tags={tags} />}
        selectedTags={selected}
        readonly={pending || failed}
        placeholder={t['com.affine.localmind.resource-display.noTags']()}
        onSelectTag={id => void save([...selected, id])}
        onDeselectTag={id => void save(selected.filter(value => value !== id))}
      />
      {failed && (
        <span role="alert">
          {t['com.affine.localmind.project-files.operationFailed']()}{' '}
          <Button
            size="default"
            onClick={() => {
              if (request.current) save().catch(() => setFailed(true));
              else {
                setFailed(false);
                service.invalidate();
              }
            }}
          >
            {t['com.affine.error.retry']()}
          </Button>
        </span>
      )}
    </div>
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
  const tags = useLiveData(useService(TagService).tagList.tagMetas$);
  const guard = useService(GuardService);
  const [canEdit, setCanEdit] = useState(false);
  const t = useI18n();
  const display = useService(DocDisplayMetaService);
  const title = useLiveData(display.title$(id));
  const { dragRef, CustomDragPreview } = useDraggable<AffineDNDData>(
    () => ({
      canDrag: !!preference.showDragHandle,
      data: { entity: { type: 'doc', id }, from: { at: 'all-docs:list' } },
    }),
    [id, preference.showDragHandle]
  );
  useEffect(() => {
    const sub = guard
      .can$('Doc_Update', id)
      .subscribe(value => setCanEdit(!!value));
    return () => sub.unsubscribe();
  }, [guard, id]);
  if (!doc) return null;
  const tagIds = (meta?.tags ?? []).filter(id =>
    tags.some(tag => tag.id === id)
  );
  const tagEditor = !canEdit ? (
    <ResourceTags tags={tags.filter(tag => tagIds.includes(tag.id))} />
  ) : (
    <WorkspaceTagsInlineEditor
      renderSelectedTags={tags => <ResourceTags tags={tags} />}
      selectedTags={tagIds}
      readonly={!canEdit}
      tagMode="inline-tag"
      placeholder={t['com.affine.localmind.resource-display.noTags']()}
      onSelectTag={tagId =>
        doc.setMeta({ tags: [...new Set([...tagIds, tagId])] })
      }
      onDeselectTag={tagId =>
        doc.setMeta({ tags: tagIds.filter(id => id !== tagId) })
      }
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
        actions={
          <>
            {quickActions
              .filter(action => action.key !== 'quickSelect')
              .map(({ key, Component }) => (
                <Component key={key} doc={doc} />
              ))}
            <MoreMenuButton docId={id} />
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
      <CustomDragPreview>{title}</CustomDragPreview>
    </div>
  );
}
