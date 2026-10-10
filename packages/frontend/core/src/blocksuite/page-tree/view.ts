import { toast } from '@affine/component';
import { DocsService } from '@affine/core/modules/doc/services/docs';
import { WorkspacePageTreeService } from '@affine/core/modules/organize';
import { WorkbenchService } from '@affine/core/modules/workbench';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { getOrCreateI18n } from '@affine/i18n';
import { createIdentifier } from '@blocksuite/affine/global/di';
import { DocCreationProvider } from '@blocksuite/affine/shared/services';
import { BlockComponent, BlockViewExtension } from '@blocksuite/affine/std';
import type { ExtensionType } from '@blocksuite/affine/store';
import { SlashMenuConfigExtension } from '@blocksuite/affine/widgets/slash-menu';
import type { FrameworkProvider } from '@toeverything/infra';
import { css, html } from 'lit';
import { state } from 'lit/decorators.js';
import { literal } from 'lit/static-html.js';
import { nanoid } from 'nanoid';

import { PAGE_TREE_DRAG_TYPE, pageTreeInteractions } from './interactions';
import type { SubpageBlockModel } from './model';

const Framework = createIdentifier<FrameworkProvider>(
  'localmind-subpage-framework'
);
class SubpageBlock extends BlockComponent<SubpageBlockModel> {
  static override styles = css`
    localmind-subpage {
      display: block;
      padding: 6px 0;
    }
    localmind-subpage button {
      border: none;
      background: transparent;
      color: var(--affine-link-color);
      font: inherit;
      cursor: pointer;
      text-align: start;
      padding: 4px 0;
    }
    localmind-subpage button:focus-visible {
      outline: 2px solid var(--affine-primary-color);
      outline-offset: 2px;
    }
    localmind-subpage small {
      color: var(--affine-text-secondary-color);
      margin-inline-start: 8px;
    }
  `;
  @state() private accessor entryTitle: string | null = null;
  @state() private accessor owned = false;
  private generation = 0;
  private nodeId: string | null = null;
  private async recycle() {
    const t = getOrCreateI18n();
    const service = this.std.get(Framework).get(WorkspacePageTreeService);
    try {
      const current = await service.locate('doc', this.model.props.resourceId);
      if (
        !current.parent ||
        current.ancestors.at(-1)?.resourceId !== this.store.id
      )
        throw new Error('Subpage moved');
      await service.confirmLifecycle(
        'trash',
        current.parent.nodeId,
        current.parent.parentNodeId
      );
    } catch {
      toast(t.t('com.affine.localmind.page-tree.error'));
    }
  }
  override connectedCallback() {
    super.connectedCallback();
    this.contentEditable = 'false';
    this.draggable = !this.store.readonly;
    const drag = (event: DragEvent) => {
      if (!this.owned || !this.nodeId || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      event.dataTransfer.setData(
        PAGE_TREE_DRAG_TYPE,
        JSON.stringify({
          workspaceId: this.std.get(Framework).get(WorkspaceService).workspace
            .id,
          nodeId: this.nodeId,
          sourceDocId: this.store.id,
          sourceBlockId: this.model.id,
        })
      );
      event.dataTransfer.effectAllowed = 'move';
    };
    this.addEventListener('dragstart', drag);
    this.disposables.add(() => this.removeEventListener('dragstart', drag));
    const service = this.std.get(Framework).get(WorkspacePageTreeService);
    const reload = () => {
      const generation = ++this.generation;
      void service
        .locate(this.model.props.kind, this.model.props.resourceId)
        .then(result => {
          if (!this.isConnected || generation !== this.generation) return;
          this.entryTitle = result.parent?.title ?? null;
          this.nodeId = result.parent?.nodeId ?? null;
          this.owned = result.ancestors.at(-1)?.resourceId === this.store.id;
        })
        .catch(() => {
          if (generation === this.generation) this.entryTitle = null;
        });
    };
    const subscription = service.layers$.subscribe(reload);
    this.disposables.add(() => {
      subscription.unsubscribe();
      this.generation++;
    });
  }
  override render() {
    const t = getOrCreateI18n();
    if (!this.entryTitle)
      return html`<small
        >${t.t('com.affine.localmind.page-tree.entryUnavailable')}</small
      >`;
    return html`<button
        @click=${() =>
          this.std
            .get(Framework)
            .get(WorkbenchService)
            .workbench.openDoc(this.model.props.resourceId)}
      >
        ${this.entryTitle}</button
      ><small
        >${t.t(
          this.owned
            ? 'com.affine.localmind.page-tree.subpage'
            : 'com.affine.localmind.page-tree.reference'
        )}</small
      >${this.owned && !this.store.readonly
        ? html`<button
            aria-label=${t.t('com.affine.localmind.resources.moveToTrash')}
            @click=${() => this.recycle()}
          >
            · ${t.t('com.affine.localmind.resources.moveToTrash')}
          </button>`
        : null}`;
  }
}
if (!customElements.get('localmind-subpage'))
  customElements.define('localmind-subpage', SubpageBlock);

export function pageTreeViewExtensions(
  framework: FrameworkProvider
): ExtensionType[] {
  return [
    pageTreeInteractions(framework),
    {
      setup: di => {
        di.addImpl(Framework, framework);
        di.addImpl(DocCreationProvider, {
          create: async () =>
            framework.get(DocsService).importDocCRUD().create(nanoid()),
        });
      },
    },
    BlockViewExtension('localmind:subpage', () => literal`localmind-subpage`),
    SlashMenuConfigExtension('localmind-page-tree', {
      items: [
        {
          name: 'Subpage',
          label: getOrCreateI18n().t('com.affine.localmind.page-tree.subpage'),
          searchAlias: ['subpage', '子页面'],
          group: '4_Advanced@9',
          when: () =>
            framework.get(WorkspacePageTreeService).enabled$.value === true,
          action: ({ std, model }) => {
            void (async () => {
              const service = framework.get(WorkspacePageTreeService);
              await framework
                .get(WorkspaceService)
                .workspace.engine.doc.waitForSynced(std.store.id);
              const current = await service.locate('doc', std.store.id);
              if (!current.parent || current.parent.primaryMode !== 'page')
                throw new Error('Subpage parent unavailable');
              await service.load(null);
              await service.execute({
                action: 'create',
                title: getOrCreateI18n().t('Untitled'),
                primaryMode: 'page',
                parentNodeId: current.parent.nodeId,
                insertAfterBlockId: model.id,
              });
              void framework
                .get(WorkspaceService)
                .workspace.engine.doc.requestPull(std.store.id)
                .catch(console.error);
            })().catch(() =>
              toast(getOrCreateI18n().t('com.affine.localmind.page-tree.error'))
            );
          },
        },
      ],
    }),
  ];
}
