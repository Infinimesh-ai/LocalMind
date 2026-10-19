import { IconButton, Input, Menu, MenuItem } from '@affine/component';
import { useI18n } from '@affine/i18n';
import {
  ArrowLeftSmallIcon,
  ArrowRightSmallIcon,
  DatabaseKanbanViewIcon,
  DatabaseListViewIcon,
  GridIcon,
  ImageIcon,
  SortIcon,
} from '@blocksuite/icons/rc';
import { Fragment, type ReactNode } from 'react';

import * as styles from './browser.css';
import {
  BROWSER_SORT_KEYS,
  type BrowserViewMode,
  type ProjectBrowserState,
  type SearchScope,
} from './use-browser-state';

export type Crumb = { id: string; label: string; onSelect?: () => void };

const VIEW_ICONS: Record<BrowserViewMode, ReactNode> = {
  icons: <GridIcon />,
  list: <DatabaseListViewIcon />,
  columns: <DatabaseKanbanViewIcon />,
  gallery: <ImageIcon />,
};

export function BrowserToolbar({
  state,
  crumbs,
  hasProject,
  actions,
}: {
  state: ProjectBrowserState;
  crumbs: Crumb[];
  hasProject: boolean;
  actions?: ReactNode;
}) {
  const t = useI18n();
  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label={t['com.affine.localmind.project-browser.label']()}
    >
      <div className={styles.toolbarGroup}>
        <IconButton
          size="16"
          icon={<ArrowLeftSmallIcon />}
          tooltip={t['com.affine.localmind.project-browser.back']()}
          aria-label={t['com.affine.localmind.project-browser.back']()}
          disabled={!state.canGoBack}
          onClick={state.goBack}
        />
        <IconButton
          size="16"
          icon={<ArrowRightSmallIcon />}
          tooltip={t['com.affine.localmind.project-browser.forward']()}
          aria-label={t['com.affine.localmind.project-browser.forward']()}
          disabled={!state.canGoForward}
          onClick={state.goForward}
        />
      </div>
      <nav
        className={styles.breadcrumb}
        aria-label={t['com.affine.localmind.project-browser.path']()}
      >
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.id}>
            {index ? (
              <span className={styles.crumbSeparator} aria-hidden>
                /
              </span>
            ) : null}
            <button
              type="button"
              className={styles.crumb}
              title={crumb.label}
              aria-current={index === crumbs.length - 1 ? 'page' : undefined}
              onClick={crumb.onSelect}
            >
              {crumb.label}
            </button>
          </Fragment>
        ))}
      </nav>
      {hasProject ? (
        <>
          <div
            className={styles.segmented}
            role="group"
            aria-label={t['com.affine.localmind.project-browser.view.label']()}
          >
            {(Object.keys(VIEW_ICONS) as BrowserViewMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                className={styles.segment}
                aria-pressed={state.viewMode === mode}
                aria-label={t[
                  `com.affine.localmind.project-browser.view.${mode}`
                ]()}
                title={t[`com.affine.localmind.project-browser.view.${mode}`]()}
                onClick={() => state.setViewMode(mode)}
              >
                {VIEW_ICONS[mode]}
              </button>
            ))}
          </div>
          <Menu
            items={
              <>
                {BROWSER_SORT_KEYS.map(key => (
                  <MenuItem
                    key={key}
                    selected={state.sort.key === key}
                    onClick={() => state.setSort({ ...state.sort, key })}
                  >
                    {t[`com.affine.localmind.project-browser.sort.${key}`]()}
                  </MenuItem>
                ))}
                {(['asc', 'desc'] as const).map(direction => (
                  <MenuItem
                    key={direction}
                    selected={
                      state.sort.key !== 'manual' &&
                      state.sort.direction === direction
                    }
                    disabled={state.sort.key === 'manual'}
                    onClick={() => state.setSort({ ...state.sort, direction })}
                  >
                    {t[
                      `com.affine.localmind.project-browser.sort.${direction}`
                    ]()}
                  </MenuItem>
                ))}
              </>
            }
          >
            <IconButton
              size="16"
              icon={<SortIcon />}
              tooltip={t['com.affine.localmind.project-browser.sort.label']()}
              aria-label={t[
                'com.affine.localmind.project-browser.sort.label'
              ]()}
            />
          </Menu>
        </>
      ) : null}
      <div className={styles.searchField}>
        <Input
          value={state.search}
          maxLength={128}
          aria-label={t[
            'com.affine.localmind.project-browser.search.placeholder'
          ]()}
          placeholder={t[
            'com.affine.localmind.project-browser.search.placeholder'
          ]()}
          onChange={state.setSearch}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              state.setSearch('');
            }
          }}
        />
      </div>
      {actions}
    </div>
  );
}

export function SearchScopeBar({
  scope,
  hasProject,
  onScopeChange,
}: {
  scope: SearchScope;
  hasProject: boolean;
  onScopeChange: (scope: SearchScope) => void;
}) {
  const t = useI18n();
  const effective = hasProject ? scope : 'all';
  return (
    <div className={styles.searchBar}>
      <div
        className={styles.segmented}
        role="group"
        aria-label={t['com.affine.localmind.project-browser.search.scope']()}
      >
        <button
          type="button"
          className={styles.segment}
          aria-pressed={effective === 'all'}
          onClick={() => onScopeChange('all')}
        >
          {t['com.affine.localmind.project-browser.search.allProjects']()}
        </button>
        <button
          type="button"
          className={styles.segment}
          aria-pressed={effective === 'project'}
          disabled={!hasProject}
          onClick={() => onScopeChange('project')}
        >
          {t['com.affine.localmind.project-browser.search.currentProject']()}
        </button>
      </div>
    </div>
  );
}
