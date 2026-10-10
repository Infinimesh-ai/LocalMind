import { toast } from '@affine/component';
import { WorkspacePageTreeService } from '@affine/core/modules/organize/services/page-tree';
import { WorkspaceService } from '@affine/core/modules/workspace/services/workspace';
import { getOrCreateI18n } from '@affine/i18n';
import { interceptUserBlockDeletion } from '@blocksuite/affine/shared/utils';
import { LifeCycleWatcher } from '@blocksuite/affine/std';
import type { BlockModel } from '@blocksuite/affine/store';
import type { FrameworkProvider } from '@toeverything/infra';
import { z } from 'zod';

import { subpageReferenceMiddleware } from './references';

export const PAGE_TREE_DRAG_TYPE = 'application/x-localmind-page-tree';
const dragSchema = z.object({
  workspaceId: z.string().max(512),
  nodeId: z.string().max(512),
  sourceDocId: z.string().max(512).optional(),
  sourceBlockId: z.string().max(512).optional(),
});

export function pageTreeInteractions(
  framework: FrameworkProvider
): typeof LifeCycleWatcher {
  return class PageTreeInteractions extends LifeCycleWatcher {
    static override key = 'localmind-page-tree-interactions';
    private readonly pending = new Set<string>();
    private release?: () => void;
    override mounted() {
      this.std.clipboard.use(subpageReferenceMiddleware);
      this.release = interceptUserBlockDeletion(this.std.store, model => {
        const entries: BlockModel[] = [];
        const queue = [model];
        while (queue.length) {
          const node = queue.pop();
          if (!node) break;
          if (node.flavour === 'localmind:subpage') entries.push(node);
          queue.push(...node.children);
        }
        if (!entries.length) return true;
        if (!this.pending.has(model.id)) {
          this.pending.add(model.id);
          void this.remove(model, entries)
            .catch(() =>
              toast(getOrCreateI18n().t('com.affine.localmind.page-tree.error'))
            )
            .finally(() => this.pending.delete(model.id));
        }
        return false;
      });
      this.std.host.addEventListener('dragover', this.dragOver, true);
      this.std.host.addEventListener('drop', this.drop, true);
    }
    override unmounted() {
      this.std.clipboard.unuse(subpageReferenceMiddleware);
      this.release?.();
      this.std.host.removeEventListener('dragover', this.dragOver, true);
      this.std.host.removeEventListener('drop', this.drop, true);
    }
    private async remove(model: BlockModel, entries: BlockModel[]) {
      const content = JSON.stringify(
        this.std.store.getTransformer().blockToSnapshot(model)
      );
      const service = framework.get(WorkspacePageTreeService);
      const owned = new Map<string, string | null>();
      const identities = entries.map(entry => {
        const props = entry.props as { resourceId?: unknown; kind?: unknown };
        if (typeof props.resourceId !== 'string' || props.kind !== 'doc')
          throw new Error('Invalid subpage entry');
        return { blockId: entry.id, resourceId: props.resourceId };
      });
      for (const identity of identities) {
        const location = await service.locate('doc', identity.resourceId);
        if (
          location.parent &&
          !location.parent.trashed &&
          location.ancestors.at(-1)?.resourceId === this.std.store.id
        )
          owned.set(location.parent.nodeId, location.parent.parentNodeId);
      }
      if (owned.size) {
        for (const [nodeId, expectedParentNodeId] of owned)
          if (
            !(await service.confirmLifecycle(
              'trash',
              nodeId,
              expectedParentNodeId
            ))
          )
            return;
      }
      if (this.std.store.getBlock(model.id)?.model !== model) return;
      for (const identity of identities) {
        const current = this.std.store.getBlock(identity.blockId)?.model
          .props as { resourceId?: unknown } | undefined;
        if (current?.resourceId !== identity.resourceId)
          throw new Error('Subpage entry changed during deletion');
      }
      if (
        JSON.stringify(
          this.std.store.getTransformer().blockToSnapshot(model)
        ) !== content
      )
        throw new Error(
          'Content changed during confirmation; keep the edited block'
        );
      this.std.store.deleteBlock(model);
    }
    private readonly dragOver = (event: DragEvent) => {
      if (
        !this.std.store.readonly &&
        event.dataTransfer?.types.includes(PAGE_TREE_DRAG_TYPE)
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
      }
    };
    private readonly drop = (event: DragEvent) => {
      if (
        this.std.store.readonly ||
        !event.dataTransfer?.types.includes(PAGE_TREE_DRAG_TYPE)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const value = event.dataTransfer.getData(PAGE_TREE_DRAG_TYPE);
      const anchorId =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-block-id]')?.dataset
              .blockId
          : null;
      void this.move(value, anchorId ?? null).catch(() =>
        toast(getOrCreateI18n().t('com.affine.localmind.page-tree.error'))
      );
    };
    private async move(value: string, anchorId: string | null) {
      if (value.length > 4096) throw new Error('Invalid drag');
      const source = dragSchema.parse(JSON.parse(value));
      const workspace = framework.get(WorkspaceService).workspace;
      if (source.workspaceId !== workspace.id)
        throw new Error('Cross Workspace move is unavailable');
      const anchor = anchorId ? this.std.store.getBlock(anchorId)?.model : null;
      const parent = anchor && this.std.store.getParent(anchor);
      const validAnchor =
        anchor &&
        parent &&
        ['affine:note', 'affine:callout'].includes(parent.flavour);
      if (source.sourceDocId === this.std.store.id && source.sourceBlockId) {
        const block = this.std.store.getBlock(source.sourceBlockId)?.model;
        if (
          !block ||
          block.flavour !== 'localmind:subpage' ||
          !validAnchor ||
          block.id === anchor.id
        )
          return;
        this.std.store.moveBlocks([block], parent, anchor, false);
        return;
      }
      const service = framework.get(WorkspacePageTreeService);
      await workspace.engine.doc.waitForSynced(this.std.store.id);
      const location = await service.locate('doc', this.std.store.id);
      if (!location.parent || location.parent.primaryMode !== 'page')
        throw new Error('Target must be a page');
      await service.load(null);
      await service.execute({
        action: 'move',
        nodeId: source.nodeId,
        parentNodeId: location.parent.nodeId,
        ...(source.sourceBlockId && validAnchor
          ? { insertAfterBlockId: anchor.id }
          : {}),
      });
      await workspace.engine.doc.requestPull(this.std.store.id);
    }
  };
}
