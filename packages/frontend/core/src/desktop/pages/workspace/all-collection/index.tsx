import { usePromptModal } from '@affine/component';
import { ExplorerPageHero } from '@affine/core/components/explorer/header/page-hero';
import { useNavigateHelper } from '@affine/core/components/hooks/use-navigate-helper';
import {
  explorerCard,
  explorerSurface,
} from '@affine/core/components/localmind-theme/surface.css';
import {
  CollectionListHeader,
  VirtualizedCollectionList,
} from '@affine/core/components/page-list';
import {
  ViewIcon,
  ViewTitle,
} from '@affine/core/modules/workbench/view/view-meta';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';
import clsx from 'clsx';
import { useCallback, useState } from 'react';

import { CollectionService } from '../../../../modules/collection';
import { ViewBody, ViewHeader } from '../../../../modules/workbench';
import { AllDocSidebarTabs } from '../layouts/all-doc-sidebar-tabs';
import { EmptyCollectionList } from '../page-list-empty';
import { AllCollectionHeader } from './header';
import * as styles from './index.css';

export const AllCollection = () => {
  const t = useI18n();
  const currentWorkspace = useService(WorkspaceService).workspace;
  const [hideHeaderCreateNew, setHideHeaderCreateNew] = useState(true);

  const collectionService = useService(CollectionService);
  const collections = useLiveData(collectionService.collections$);

  const navigateHelper = useNavigateHelper();
  const { openPromptModal } = usePromptModal();

  const handleCreateCollection = useCallback(() => {
    openPromptModal({
      title: t['com.affine.editCollection.saveCollection'](),
      label: t['com.affine.editCollectionName.name'](),
      inputOptions: {
        placeholder: t['com.affine.editCollectionName.name.placeholder'](),
      },
      children: (
        <div className={styles.createTips}>
          {t['com.affine.editCollectionName.createTips']()}
        </div>
      ),
      confirmText: t['com.affine.editCollection.save'](),
      cancelText: t['com.affine.editCollection.button.cancel'](),
      confirmButtonOptions: {
        variant: 'primary',
      },
      onConfirm(name) {
        const id = collectionService.createCollection({ name });
        navigateHelper.jumpToCollection(currentWorkspace.id, id);
      },
    });
  }, [
    collectionService,
    currentWorkspace.id,
    navigateHelper,
    openPromptModal,
    t,
  ]);

  return (
    <>
      <ViewTitle title={t['Collections']()} />
      <ViewIcon icon="collection" />
      <ViewHeader>
        <AllCollectionHeader
          showCreateNew={!hideHeaderCreateNew}
          onCreateCollection={handleCreateCollection}
        />
      </ViewHeader>
      <ViewBody>
        <div className={clsx(styles.body, explorerSurface)}>
          <ExplorerPageHero
            section={t['com.affine.collections.header']()}
            title={t['com.affine.collections.header']()}
            subtitle={t['com.affine.localmind.shell.collections.subtitle']()}
          />
          <div className={clsx(styles.list, explorerCard)}>
            {collections.size > 0 ? (
              <VirtualizedCollectionList
                setHideHeaderCreateNewCollection={setHideHeaderCreateNew}
                handleCreateCollection={handleCreateCollection}
              />
            ) : (
              <EmptyCollectionList
                heading={
                  <CollectionListHeader onCreate={handleCreateCollection} />
                }
              />
            )}
          </div>
        </div>
      </ViewBody>
      <AllDocSidebarTabs />
    </>
  );
};

export const Component = () => {
  return <AllCollection />;
};
