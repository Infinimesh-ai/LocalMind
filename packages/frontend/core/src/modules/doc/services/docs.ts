import { DebugLogger } from '@affine/debug';
import { Unreachable } from '@affine/env/constant';
import { replaceIdMiddleware } from '@blocksuite/affine/shared/adapters';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import type { DeltaInsert, DocCRUD } from '@blocksuite/affine/store';
import { Slice, Text, Transformer } from '@blocksuite/affine/store';
import { ObjectPool, Service } from '@toeverything/infra';
import { combineLatest, filter, firstValueFrom, map, timeout } from 'rxjs';

import { initDocFromProps } from '../../../blocksuite/initialization';
import { subpageReferenceMiddleware } from '../../../blocksuite/page-tree/references';
import type { WorkspacePageTreeService } from '../../organize/services/page-tree';
import { getAFFiNEWorkspaceSchema } from '../../workspace/global-schema';
import type { WorkspaceService } from '../../workspace/services/workspace';
import type { Doc } from '../entities/doc';
import { DocRecordList } from '../entities/record-list';
import { DocCreated, DocInitialized } from '../events';
import type { DocCreateMiddleware } from '../providers/doc-create-middleware';
import { DocScope } from '../scopes/doc';
import type { DocPropertiesStore } from '../stores/doc-properties';
import type { DocsStore } from '../stores/docs';
import type { DocCreateOptions } from '../types';
import { DocService } from './doc';
import { getDuplicatedDocTitle } from './duplicate-title';
import { hasLinkedDocReference, removeLinkedDocReferences } from './linked-doc';

const logger = new DebugLogger('DocsService');

export type AddLinkedDocResult = 'added' | 'already-linked' | 'self-link';

export class DocsService extends Service {
  private readonly pendingCreation = new Map<string, string>();
  list = this.framework.createEntity(DocRecordList);

  pool = new ObjectPool<string, Doc>({
    onDelete(obj) {
      obj.scope.dispose();
    },
  });

  /**
   * Get all property values of a property, used for search
   *
   * Results may include docs in trash or deleted docs
   * Legacy property data such as old `journal` will not be included in the values
   */
  propertyValues$(propertyKey: string) {
    return combineLatest([
      this.store.watchDocIds(),
      this.docPropertiesStore.watchPropertyAllValues(propertyKey),
    ]).pipe(
      map(([docIds, propertyValues]) => {
        const result = new Map<string, string | undefined>();
        for (const docId of docIds) {
          result.set(docId, propertyValues.get(docId));
        }
        return result;
      })
    );
  }

  /**
   * used for search
   */
  allDocsCreatedDate$() {
    return this.store.watchAllDocCreateDate();
  }

  /**
   * used for search
   */
  allDocsUpdatedDate$() {
    return this.store.watchAllDocUpdatedDate();
  }

  allDocsTagIds$() {
    return this.store.watchAllDocTagIds();
  }

  allDocIds$() {
    return this.store.watchDocIds();
  }

  allNonTrashDocIds$() {
    return this.store.watchNonTrashDocIds();
  }

  allTrashDocIds$() {
    return this.store.watchTrashDocIds();
  }

  allDocTitle$() {
    return this.store.watchAllDocTitle();
  }

  constructor(
    private readonly store: DocsStore,
    private readonly docPropertiesStore: DocPropertiesStore,
    private readonly docCreateMiddlewares: DocCreateMiddleware[],
    private readonly pageTree: WorkspacePageTreeService,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  loaded(docId: string) {
    const exists = this.pool.get(docId);
    if (exists) {
      return { doc: exists.obj, release: exists.release };
    }
    return null;
  }

  open(docId: string) {
    const docRecord = this.list.doc$(docId).value;
    if (!docRecord) {
      throw new Error('Doc record not found');
    }
    const blockSuiteDoc = this.store.getBlockSuiteDoc(docId);
    if (!blockSuiteDoc) {
      throw new Error('Doc not found');
    }

    const exists = this.pool.get(docId);
    if (exists) {
      return { doc: exists.obj, release: exists.release };
    }

    const docScope = this.framework.createScope(DocScope, {
      docId,
      blockSuiteDoc,
      record: docRecord,
    });

    try {
      blockSuiteDoc.load();
    } catch (e) {
      logger.error('Failed to load doc', {
        docId,
        error: e,
      });
    }

    const doc = docScope.get(DocService).doc;

    doc.scope.emitEvent(DocInitialized, doc);

    const { obj, release } = this.pool.put(docId, doc);

    return { doc: obj, release };
  }

  createDoc(options: DocCreateOptions = {}) {
    if (this.pageTree.enabled$.value === true)
      throw new Error('Use the page tree creation command for this Workspace');
    for (const middleware of this.docCreateMiddlewares) {
      options = middleware.beforeCreate
        ? middleware.beforeCreate(options)
        : options;
    }
    const id = this.store.createDoc(options.id);
    const docStore = this.store.getBlockSuiteDoc(id);
    if (!docStore) {
      throw new Error('Failed to create doc');
    }
    if (options.skipInit !== true) {
      initDocFromProps(docStore, options.docProps, options);
    }
    const docRecord = this.list.doc$(id).value;
    if (!docRecord) {
      throw new Unreachable();
    }
    if (options.primaryMode) {
      docRecord.setPrimaryMode(options.primaryMode);
    }
    if (options.isTemplate) {
      docRecord.setProperty('isTemplate', true);
    }
    for (const middleware of this.docCreateMiddlewares) {
      middleware.afterCreate?.(docRecord, options);
    }
    const createdAt = Date.now();
    docRecord.setCreatedAt(createdAt);
    this.store.recordUpdate(id, createdAt);
    this.eventBus.emit(DocCreated, {
      doc: docRecord,
      docCreateOptions: options,
    });
    return docRecord;
  }

  /** Online creation waits for authoritative ownership before exposing an editor. */
  async createDocAsync(options: DocCreateOptions = {}) {
    if (this.pageTree.enabled$.value === null) await this.pageTree.load(null);
    if (this.pageTree.enabled$.value === null)
      throw new Error('Connect to create a page');
    if (!this.pageTree.enabled$.value) return this.createDoc(options);
    for (const middleware of this.docCreateMiddlewares)
      options = middleware.beforeCreate?.(options) ?? options;
    const generation = this.pageTree.accountGeneration;
    const creationKey = JSON.stringify([generation, options]);
    let resourceId = this.pendingCreation.get(creationKey);
    if (!resourceId) {
      const receipt = await this.pageTree.execute({
        action: 'create',
        title: options.title?.trim() || 'Untitled',
        primaryMode: options.primaryMode ?? 'page',
        ...(options.id ? { resourceId: options.id } : {}),
        parentNodeId: options.parentNodeId ?? null,
      });
      resourceId = receipt.resourceId;
      this.pendingCreation.set(creationKey, resourceId);
    }
    const workspace = this.workspaceService.workspace;
    await workspace.engine.doc.requestPull(workspace.id);
    const docRecord = await firstValueFrom(
      this.list.doc$(resourceId).pipe(
        filter(record => !!record),
        timeout(15_000)
      )
    );
    if (generation !== this.pageTree.accountGeneration)
      throw new Error('Account changed while creating a page');
    this.pendingCreation.delete(creationKey);
    if (options.isTemplate) docRecord.setProperty('isTemplate', true);
    if (options.docProps) {
      const { doc, release } = this.open(docRecord.id);
      try {
        await doc.waitForSyncReady();
        initDocFromProps(doc.blockSuiteDoc, options.docProps, options);
      } finally {
        release();
      }
    }
    for (const middleware of this.docCreateMiddlewares)
      middleware.afterCreate?.(docRecord, options);
    this.eventBus.emit(DocCreated, {
      doc: docRecord,
      docCreateOptions: options,
    });
    return docRecord;
  }

  /** Import adapters allocate through the same ownership command as the UI. */
  importDocCRUD(): DocCRUD {
    const collection = this.store.getBlocksuiteCollection();
    return {
      create: async id => {
        await this.createDocAsync({ id, skipInit: true });
        const { doc, release } = this.open(id);
        try {
          await doc.waitForSyncReady();
          const store = doc.blockSuiteDoc;
          if (store.root) store.deleteBlock(store.root);
          return store;
        } finally {
          release();
        }
      },
      get: id => collection.getDoc(id)?.getStore({ id }) ?? null,
      delete: () => {
        throw new Error('Imported resources must use the normal Trash action');
      },
    };
  }

  async addLinkedDoc(
    targetDocId: string,
    linkedDocId: string
  ): Promise<AddLinkedDocResult> {
    if (targetDocId === linkedDocId) {
      return 'self-link';
    }

    const { doc, release } = this.open(targetDocId);
    const disposePriorityLoad = doc.addPriorityLoad(10);
    try {
      await doc.waitForSyncReady();
      if (hasLinkedDocReference(doc.blockSuiteDoc, linkedDocId)) {
        return 'already-linked';
      }

      const [frame] = doc.blockSuiteDoc.getBlocksByFlavour('affine:note');
      if (!frame) {
        throw new Error('Target doc note not found');
      }

      const text = new Text([
        {
          insert: ' ',
          attributes: {
            reference: {
              type: 'LinkedPage',
              pageId: linkedDocId,
            },
          },
        },
      ] as DeltaInsert<AffineTextAttributes>[]);
      doc.blockSuiteDoc.addBlock(
        'affine:paragraph' as never, // TODO(eyhn): fix type
        { text },
        frame.id
      );
      return 'added';
    } finally {
      disposePriorityLoad();
      release();
    }
  }

  async removeLinkedDoc(sourceDocId: string, linkedDocId: string) {
    if (sourceDocId === linkedDocId) {
      return false;
    }

    const { doc, release } = this.open(sourceDocId);
    const disposePriorityLoad = doc.addPriorityLoad(10);
    try {
      await doc.waitForSyncReady();
      return removeLinkedDocReferences(doc.blockSuiteDoc, linkedDocId) > 0;
    } finally {
      disposePriorityLoad();
      release();
    }
  }

  async changeDocTitle(docId: string, newTitle: string) {
    const { doc, release } = this.open(docId);
    const disposePriorityLoad = doc.addPriorityLoad(10);
    await doc.waitForSyncReady();
    disposePriorityLoad();
    doc.changeDocTitle(newTitle);
    release();
  }

  async duplicate(sourceDocId: string, _targetDocId?: string) {
    const targetDocId = _targetDocId ?? (await this.createDocAsync()).id;

    // check if source doc is removed
    if (this.list.doc$(sourceDocId).value?.trash$.value) {
      console.warn(
        `Template doc(id: ${sourceDocId}) is removed, skip duplicate`
      );
      return targetDocId;
    }

    const { release: sourceRelease, doc: sourceDoc } = this.open(sourceDocId);
    const { release: targetRelease, doc: targetDoc } = this.open(targetDocId);
    await sourceDoc.waitForSyncReady();
    await targetDoc.waitForSyncReady();

    // duplicate doc content
    try {
      const sourceBsDoc = this.store.getBlockSuiteDoc(sourceDocId);
      const targetBsDoc = this.store.getBlockSuiteDoc(targetDocId);
      if (!sourceBsDoc) throw new Error('Source doc not found');
      if (!targetBsDoc) throw new Error('Target doc not found');

      // clear the target doc (both surface and note)
      targetBsDoc.root?.children.forEach(child =>
        targetBsDoc.deleteBlock(child)
      );

      const collection = this.store.getBlocksuiteCollection();
      const transformer = new Transformer({
        schema: getAFFiNEWorkspaceSchema(),
        blobCRUD: collection.blobSync,
        docCRUD: this.importDocCRUD(),
        middlewares: [
          subpageReferenceMiddleware,
          replaceIdMiddleware(collection.idGenerator),
        ],
      });
      const slice = Slice.fromModels(sourceBsDoc, [
        ...(sourceBsDoc.root?.children ?? []),
      ]);
      const snapshot = transformer.sliceToSnapshot(slice);
      if (!snapshot) {
        throw new Error('Failed to create snapshot');
      }
      await transformer.snapshotToSlice(
        snapshot,
        targetBsDoc,
        targetBsDoc.root?.id
      );
    } catch (e) {
      logger.error('Failed to duplicate doc', {
        sourceDocId,
        targetDocId,
        originalTargetDocId: _targetDocId,
        error: e,
      });
    } finally {
      sourceRelease();
      targetRelease();
    }

    // duplicate doc meta
    targetDoc.record.setMeta({
      tags: sourceDoc.meta$.value.tags,
    });

    // duplicate doc title
    targetDoc.changeDocTitle(getDuplicatedDocTitle(sourceDoc.title$.value));

    // duplicate doc properties
    const properties = { ...sourceDoc.getProperties() };
    const removedProperties = [
      'id',
      'isTemplate',
      'journal',
      'createdBy',
      'updatedBy',
    ];
    removedProperties.forEach(key => {
      delete properties[key];
    });
    targetDoc.updateProperties(properties);

    return targetDocId;
  }

  /**
   * Duplicate a doc from template
   * @param sourceDocId - the id of the source doc to be duplicated
   * @param _targetDocId - the id of the target doc to be duplicated, if not provided, a new doc will be created
   * @returns the id of the new doc
   */
  async duplicateFromTemplate(sourceDocId: string, _targetDocId?: string) {
    const targetDocId = _targetDocId ?? (await this.createDocAsync()).id;

    // check if source doc is removed
    if (this.list.doc$(sourceDocId).value?.trash$.value) {
      console.warn(
        `Template doc(id: ${sourceDocId}) is removed, skip duplicate`
      );
      return targetDocId;
    }

    const { release: sourceRelease, doc: sourceDoc } = this.open(sourceDocId);
    const { release: targetRelease, doc: targetDoc } = this.open(targetDocId);
    await sourceDoc.waitForSyncReady();
    await targetDoc.waitForSyncReady();

    // duplicate doc content
    try {
      const sourceBsDoc = this.store.getBlockSuiteDoc(sourceDocId);
      const targetBsDoc = this.store.getBlockSuiteDoc(targetDocId);
      if (!sourceBsDoc) throw new Error('Source doc not found');
      if (!targetBsDoc) throw new Error('Target doc not found');

      // clear the target doc (both surface and note)
      targetBsDoc.root?.children.forEach(child =>
        targetBsDoc.deleteBlock(child)
      );

      const collection = this.store.getBlocksuiteCollection();
      const transformer = new Transformer({
        schema: getAFFiNEWorkspaceSchema(),
        blobCRUD: collection.blobSync,
        docCRUD: this.importDocCRUD(),
        middlewares: [
          subpageReferenceMiddleware,
          replaceIdMiddleware(collection.idGenerator),
        ],
      });
      const slice = Slice.fromModels(sourceBsDoc, [
        ...(sourceBsDoc.root?.children ?? []),
      ]);
      const snapshot = transformer.sliceToSnapshot(slice);
      if (!snapshot) {
        throw new Error('Failed to create snapshot');
      }
      await transformer.snapshotToSlice(
        snapshot,
        targetBsDoc,
        targetBsDoc.root?.id
      );
    } catch (e) {
      logger.error('Failed to duplicate doc', {
        sourceDocId,
        targetDocId,
        originalTargetDocId: _targetDocId,
        error: e,
      });
    } finally {
      sourceRelease();
      targetRelease();
    }

    // duplicate doc properties
    const properties = { ...sourceDoc.getProperties() };
    const removedProperties = [
      'id',
      'isTemplate',
      'journal',
      'createdBy',
      'updatedBy',
    ];
    removedProperties.forEach(key => {
      delete properties[key];
    });
    targetDoc.updateProperties(properties);

    return targetDocId;
  }
}
