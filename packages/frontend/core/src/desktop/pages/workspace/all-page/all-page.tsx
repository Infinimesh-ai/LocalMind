import { Button, toast, usePromptModal } from '@affine/component';
import {
  createDocExplorerContext,
  DocExplorerContext,
} from '@affine/core/components/explorer/context';
import { DocsExplorer } from '@affine/core/components/explorer/docs-view/docs-list';
import {
  migrateResourcePreference,
  resourcePreferenceKey,
} from '@affine/core/components/explorer/resource-preferences';
import type { ExplorerDisplayPreference } from '@affine/core/components/explorer/types';
import { Filters } from '@affine/core/components/filter';
import { WorkspaceResourceExplorer } from '@affine/core/components/native-files/resource-explorer';
import { WorkspaceServerService } from '@affine/core/modules/cloud';
import {
  CollectionService,
  PinnedCollectionService,
} from '@affine/core/modules/collection';
import { CollectionRulesService } from '@affine/core/modules/collection-rules';
import type { FilterParams } from '@affine/core/modules/collection-rules/types';
import { WorkspaceDBService } from '@affine/core/modules/db';
import { DocsService } from '@affine/core/modules/doc';
import {
  WorkspaceLocalState,
  WorkspaceService,
} from '@affine/core/modules/workspace';
import { WorkspacePropertyService } from '@affine/core/modules/workspace-property';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

import {
  ViewBody,
  ViewHeader,
  ViewIcon,
  ViewTitle,
} from '../../../../modules/workbench';
import { AllDocSidebarTabs } from '../layouts/all-doc-sidebar-tabs';
import * as styles from './all-page.css';
import { AllDocsHeader } from './all-page-header';
import { MigrationAllDocsDataNotification } from './migration-data';
import { PinnedCollections } from './pinned-collections';

const DefaultDisplayPreference: {
  [key in ViewMode]: ExplorerDisplayPreference;
} = {
  grid: {
    view: 'grid',
    displayProperties: [
      'system:createdAt',
      'system:updatedAt',
      'system:createdBy',
      'system:tags',
    ],
    orderBy: {
      type: 'system',
      key: 'updatedAt',
      desc: true,
    },
    groupBy: undefined,
    showDocIcon: true,
    showDocPreview: true,
    quickFavorite: true,
    showDragHandle: true,
    showMoreOperation: true,
  },
  masonry: {
    view: 'masonry',
    displayProperties: [
      'system:createdAt',
      'system:updatedAt',
      'system:createdBy',
      'system:tags',
    ],
    orderBy: {
      type: 'system',
      key: 'updatedAt',
      desc: true,
    },
    groupBy: undefined,
    showDocIcon: true,
    showDocPreview: true,
    quickFavorite: true,
    showDragHandle: true,
    showMoreOperation: true,
  },
  list: {
    view: 'list',
    displayProperties: [
      'system:createdAt',
      'system:updatedAt',
      'system:createdBy',
      'system:tags',
    ],
    orderBy: {
      type: 'system',
      key: 'updatedAt',
      desc: true,
    },
    groupBy: {
      type: 'system',
      key: 'updatedAt',
    },
    showDocIcon: true,
    showDocPreview: true,
    quickFavorite: true,
    showDragHandle: true,
    showMoreOperation: true,
  },
};

type ViewMode = NonNullable<ExplorerDisplayPreference['view']>;

export const AllPage = () => {
  const t = useI18n();

  const [tempFilters, setTempFilters] = useState<FilterParams[] | null>(null);
  const [tempFiltersInitial, setTempFiltersInitial] =
    useState<FilterParams | null>(null);
  const collectionService = useService(CollectionService);
  const pinnedCollectionService = useService(PinnedCollectionService);
  const {
    viewMode,
    setViewMode,
    selectedCollectionId,
    setSelectedCollectionId,
    displayPreference: resourcePreference,
    setDisplayPreference: setResourcePreference,
    legacyPreference,
    setLegacyPreference,
  } = useAllDocsOptions();
  const definitions = useLiveData(
    useService(WorkspacePropertyService).sortedProperties$
  );
  const mixed =
    !selectedCollectionId &&
    (!tempFilters?.length ||
      tempFilters.every(
        filter =>
          (filter.type === 'system'
            ? filter.key
            : definitions.find(definition => definition.id === filter.key)
                ?.type) === 'tags'
      ));
  const displayPreference = mixed ? resourcePreference : legacyPreference;
  const setDisplayPreference = mixed
    ? setResourcePreference
    : setLegacyPreference;

  const isCollectionDataReady = useLiveData(
    collectionService.collectionDataReady$
  );

  const isPinnedCollectionDataReady = useLiveData(
    pinnedCollectionService.pinnedCollectionDataReady$
  );

  const pinnedCollections = useLiveData(
    pinnedCollectionService.pinnedCollections$
  );

  const selectedCollection = useLiveData(
    selectedCollectionId
      ? collectionService.collection$(selectedCollectionId)
      : null
  );

  useEffect(() => {
    // if selected collection is not in pinned collections, set selected collection id to null
    if (
      isPinnedCollectionDataReady &&
      selectedCollectionId &&
      !pinnedCollections.some(c => c.collectionId === selectedCollectionId)
    ) {
      setSelectedCollectionId(null);
    }
  }, [
    isPinnedCollectionDataReady,
    pinnedCollections,
    selectedCollectionId,
    setSelectedCollectionId,
  ]);

  useEffect(() => {
    // if selected collection is not found, set selected collection id to null
    if (!selectedCollection && selectedCollectionId && isCollectionDataReady) {
      setSelectedCollectionId(null);
    }
  }, [
    isCollectionDataReady,
    selectedCollection,
    selectedCollectionId,
    setSelectedCollectionId,
  ]);

  const selectedCollectionInfo = useLiveData(
    selectedCollection ? selectedCollection.info$ : null
  );

  const [explorerContextValue] = useState(() =>
    createDocExplorerContext(displayPreference)
  );

  useEffect(() => {
    explorerContextValue.displayPreference$.next(displayPreference);
  }, [displayPreference, explorerContextValue]);

  // The mixed explorer performs one comparison over the complete authorized catalog.
  const groupBy = mixed ? undefined : displayPreference.groupBy;
  const orderBy = mixed ? undefined : displayPreference.orderBy;

  const { openPromptModal } = usePromptModal();

  const collectionRulesService = useService(CollectionRulesService);
  useEffect(() => {
    const subscription = collectionRulesService
      .watch(
        selectedCollectionInfo
          ? {
              filters: selectedCollectionInfo.rules.filters,
              groupBy,
              orderBy,
              extraAllowList: selectedCollectionInfo.allowList,
              extraFilters: [
                {
                  type: 'system',
                  key: 'empty-journal',
                  method: 'is',
                  value: 'false',
                },
                {
                  type: 'system',
                  key: 'trash',
                  method: 'is',
                  value: 'false',
                },
              ],
            }
          : {
              filters:
                tempFilters && tempFilters.length > 0
                  ? tempFilters
                  : [
                      // if no filters are present, match all non-trash documents
                      {
                        type: 'system',
                        key: 'trash',
                        method: 'is',
                        value: 'false',
                      },
                    ],
              groupBy,
              orderBy,
              extraFilters: [
                {
                  type: 'system',
                  key: 'empty-journal',
                  method: 'is',
                  value: 'false',
                },
                {
                  type: 'system',
                  key: 'trash',
                  method: 'is',
                  value: 'false',
                },
              ],
            }
      )
      .subscribe({
        next: result => {
          explorerContextValue.groups$.next(result.groups);
        },
        error: error => {
          console.error(error);
        },
      });
    return () => {
      subscription.unsubscribe();
    };
  }, [
    collectionRulesService,
    explorerContextValue,
    groupBy,
    orderBy,
    selectedCollection,
    selectedCollectionInfo,
    tempFilters,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        explorerContextValue.selectMode$.next(false);
        explorerContextValue.selectedDocIds$.next([]);
        explorerContextValue.prevCheckAnchorId$.next(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [explorerContextValue]);

  const handleFilterChange = useCallback((filters: FilterParams[]) => {
    setTempFilters(filters);
  }, []);

  const handleSelectCollection = useCallback(
    (collectionId: string) => {
      setSelectedCollectionId(collectionId);
      setTempFilters(null);
    },
    [setSelectedCollectionId]
  );

  const handleSelectAll = useCallback(() => {
    setSelectedCollectionId(null);
    setTempFilters(null);
  }, [setSelectedCollectionId]);

  const handleSaveFilters = useCallback(() => {
    if (selectedCollectionId) {
      collectionService.updateCollection(selectedCollectionId, {
        rules: {
          filters: tempFilters ?? [],
        },
      });
      setTempFilters(null);
    } else {
      openPromptModal({
        title: t['com.affine.editCollection.saveCollection'](),
        label: t['com.affine.editCollectionName.name'](),
        inputOptions: {
          placeholder: t['com.affine.editCollectionName.name.placeholder'](),
        },
        children: t['com.affine.editCollectionName.createTips'](),
        confirmText: t['com.affine.editCollection.save'](),
        cancelText: t['com.affine.editCollection.button.cancel'](),
        confirmButtonOptions: {
          variant: 'primary',
        },
        onConfirm(name) {
          const id = collectionService.createCollection({
            name,
            rules: {
              filters: tempFilters ?? [],
            },
          });
          pinnedCollectionService.addPinnedCollection({
            collectionId: id,
            index: pinnedCollectionService.indexAt('after'),
          });
          setTempFilters(null);
          setSelectedCollectionId(id);
        },
      });
    }
  }, [
    collectionService,
    openPromptModal,
    pinnedCollectionService,
    selectedCollectionId,
    setSelectedCollectionId,
    t,
    tempFilters,
  ]);

  const handleNewTempFilter = useCallback(
    (params: FilterParams) => {
      setSelectedCollectionId(null);
      setTempFilters([]);
      setTempFiltersInitial(params);
    },
    [setSelectedCollectionId]
  );

  const handleDisplayPreferenceChange = useCallback(
    (displayPreference: ExplorerDisplayPreference) => {
      setDisplayPreference(displayPreference);
    },
    [setDisplayPreference]
  );

  return (
    <DocExplorerContext.Provider value={explorerContextValue}>
      <ViewTitle title={t['All pages']()} />
      <ViewIcon icon="allDocs" />
      <ViewHeader>
        <AllDocsHeader
          displayPreference={displayPreference}
          onDisplayPreferenceChange={handleDisplayPreferenceChange}
          view={viewMode}
          onViewChange={setViewMode}
        />
      </ViewHeader>
      <ViewBody>
        <div className={styles.body}>
          <MigrationAllDocsDataNotification />
          <div className={styles.pinnedCollection}>
            <PinnedCollections
              activeCollectionId={selectedCollectionId}
              onActiveAll={handleSelectAll}
              onActiveCollection={handleSelectCollection}
              onAddFilter={handleNewTempFilter}
              hiddenAdd={tempFilters !== null}
            />
          </div>
          <div className={styles.filterArea}>
            {tempFilters !== null && (
              <div className={styles.filterInnerArea}>
                <Filters
                  // When the selected collection changes, the filters internal state should be reset
                  key={selectedCollectionId ?? 'all'}
                  className={styles.filters}
                  filters={tempFilters}
                  onChange={handleFilterChange}
                  defaultDraftFilter={tempFiltersInitial}
                />
                <Button
                  variant="plain"
                  onClick={() => {
                    setTempFilters(null);
                  }}
                >
                  {t['Cancel']()}
                </Button>
                <Button onClick={handleSaveFilters}>{t['Save']()}</Button>
              </div>
            )}
          </div>
          <div className={styles.scrollArea}>
            {mixed ? (
              <WorkspaceResourceExplorer filters={tempFilters ?? []} />
            ) : (
              <>
                <p>{t['com.affine.localmind.resources.documentFilter']()}</p>
                <DocsExplorer />
              </>
            )}
          </div>
        </div>
      </ViewBody>
      <AllDocSidebarTabs />
    </DocExplorerContext.Provider>
  );
};

export const Component = () => {
  return <AllPage />;
};

/**
 * Since split view allows users to open multiple all docs simultaneously, each with its own state,
 * we only read the stored state once during useState initialization to maintain independent states.
 */
const useAllDocsOptions = () => {
  const workspaceLocalState = useService(WorkspaceLocalState);
  const serverService = useService(WorkspaceServerService);
  const server = useLiveData(serverService.server$);
  const account = useLiveData(server?.account$);
  const definitions = useLiveData(
    useService(WorkspacePropertyService).sortedProperties$
  );
  const t = useI18n();
  const { workspace } = useService(WorkspaceService);
  const isLocal = workspace.flavour === 'local';
  const definitionsReady = useLiveData(
    useService(WorkspaceDBService).db.docCustomPropertyInfo.isReady$
  );
  const rootReady = useLiveData(useService(DocsService).list.isAvailable$);
  const ready = definitionsReady && rootReady && (isLocal || !!account?.id);
  const identity = isLocal
    ? null
    : `${server?.baseUrl ?? 'pending'}:${account?.id ?? 'signed-out'}`;
  const scope = JSON.stringify(identity ?? 'local');
  const [viewMode, setViewMode] = useState<ViewMode>(
    () =>
      workspaceLocalState.get<ViewMode>(`allResources:view:${scope}`) ?? 'list'
  );
  const readLegacy = useCallback(
    (mode: ViewMode) => ({
      ...DefaultDisplayPreference[mode],
      ...workspaceLocalState.get<ExplorerDisplayPreference>(
        'allDocsDisplayPreference:' + mode
      ),
      view: mode,
    }),
    [workspaceLocalState]
  );
  const read = useCallback(
    (mode: ViewMode) => {
      const key = resourcePreferenceKey(identity, mode);
      const saved = workspaceLocalState.get<ExplorerDisplayPreference>(key);
      // An unscoped legacy preference may be claimed once, never inherited by another account.
      const owner = workspaceLocalState.get<string>('allResources:legacyOwner');
      const legacy =
        !saved && (!owner || owner === scope)
          ? workspaceLocalState.get<ExplorerDisplayPreference>(
              'allDocsDisplayPreference:' + mode
            )
          : undefined;
      return migrateResourcePreference(saved ?? legacy, definitions, {
        ...DefaultDisplayPreference[mode],
        view: mode,
      });
    },
    [definitions, identity, scope, workspaceLocalState]
  );
  const [state, setState] = useState(() => ({
    scope,
    mode: viewMode,
    preference: read(viewMode).preference,
  }));
  const displayPreference =
    state.scope === scope && state.mode === viewMode
      ? state.preference
      : read(viewMode).preference;
  const [legacyPreference, setLegacyPreferenceState] =
    useState<ExplorerDisplayPreference>(() => readLegacy(viewMode));
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (!ready) return;
    const mode =
      workspaceLocalState.get<ViewMode>(`allResources:view:${scope}`) ?? 'list';
    setViewMode(mode);
    setSelectedCollectionId(
      workspaceLocalState.get<string | null>(
        `allResources:collection:${scope}`
      ) ?? null
    );
    setLegacyPreferenceState(readLegacy(mode));
    const migrated = read(mode);
    setState({ scope, mode, preference: migrated.preference });
    if (!workspaceLocalState.get('allResources:legacyOwner'))
      workspaceLocalState.set('allResources:legacyOwner', scope);
    if (migrated.adjustedSort)
      toast(t['com.affine.localmind.resource-display.migratedSort']());
    workspaceLocalState.set(
      resourcePreferenceKey(identity, mode),
      migrated.preference
    );
  }, [scope, workspaceLocalState, ready, identity, readLegacy, read, t]);
  const changeView = useCallback(
    (mode: ViewMode) => {
      workspaceLocalState.set(`allResources:view:${scope}`, mode);
      setViewMode(mode);
      setState({ scope, mode, preference: read(mode).preference });
      setLegacyPreferenceState(readLegacy(mode));
    },
    [scope, read, readLegacy, workspaceLocalState]
  );
  const changePreference = useCallback(
    (preference: ExplorerDisplayPreference) => {
      workspaceLocalState.set(
        resourcePreferenceKey(identity, viewMode),
        preference
      );
      setState({ scope, mode: viewMode, preference });
    },
    [identity, scope, viewMode, workspaceLocalState]
  );
  const setLegacyPreference = useCallback(
    (preference: ExplorerDisplayPreference) => {
      workspaceLocalState.set(
        'allDocsDisplayPreference:' + viewMode,
        preference
      );
      setLegacyPreferenceState(preference);
    },
    [viewMode, workspaceLocalState]
  );
  return {
    viewMode,
    setViewMode: changeView,
    displayPreference,
    setDisplayPreference: changePreference,
    legacyPreference,
    setLegacyPreference,
    selectedCollectionId,
    setSelectedCollectionId: (id: string | null) => {
      workspaceLocalState.set(`allResources:collection:${scope}`, id);
      setSelectedCollectionId(id);
    },
  };
};
