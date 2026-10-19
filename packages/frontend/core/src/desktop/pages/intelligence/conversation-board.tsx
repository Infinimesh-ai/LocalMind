import { Button, Loading } from '@affine/component';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { useI18n } from '@affine/i18n';
import { PlusIcon, SidebarIcon } from '@blocksuite/icons/rc';
import { Fragment, useState } from 'react';

import { CollaborationOrbitBoard } from './collaboration-orbit-board';
import * as styles from './conversation-board.css';
import type {
  WorkbenchCollaborationGraph,
  WorkbenchConversationCard,
  WorkbenchConversationColumn,
  WorkbenchProject,
} from './types';
import type { ConversationCardsState } from './use-conversation-cards';
import { attentionLabel } from './workbench-labels';

type ConversationBoardProps = {
  cards: ConversationCardsState;
  filteredCards?: ConversationCardsState;
  filter?: string;
  onFilterChange?: (filter: string) => void;
  projects: WorkbenchProject[];
  projectsResolved?: boolean;
  onOpenCard: (card: WorkbenchConversationCard) => void;
  onOpenRelation: (
    relation: WorkbenchCollaborationGraph['edges'][number]
  ) => void | Promise<void>;
  onNewConversation: () => void;
  onSignIn?: () => void;
  workspaceExpanded: boolean;
  onWorkspaceExpandedChange: (expanded: boolean) => void;
};

const COLUMNS: Array<{
  id: WorkbenchConversationColumn;
  titleKey:
    | 'com.affine.localmind.workbench.v9.todo'
    | 'com.affine.localmind.workbench.v9.progress'
    | 'com.affine.localmind.workbench.v9.done';
}> = [
  { id: 'todo', titleKey: 'com.affine.localmind.workbench.v9.todo' },
  { id: 'progress', titleKey: 'com.affine.localmind.workbench.v9.progress' },
  { id: 'done', titleKey: 'com.affine.localmind.workbench.v9.done' },
];

/** Group by real card type; labels only appear when a column mixes types. */
function groupCards(cards: WorkbenchConversationCard[]) {
  const orders = cards.filter(card => card.scopeType === 'work_order');
  const chats = cards.filter(card => card.scopeType !== 'work_order');
  const mixed = orders.length > 0 && chats.length > 0;
  return [
    {
      kind: 'work_order',
      label: mixed
        ? ('com.affine.localmind.workbench.v9.personalWorkOrder' as const)
        : null,
      cards: orders,
    },
    {
      kind: 'conversation',
      label: mixed
        ? ('com.affine.localmind.workbench.overview.conversations' as const)
        : null,
      cards: chats,
    },
  ].filter(group => group.cards.length > 0);
}

function Card({
  card,
  column,
  onOpen,
}: {
  card: WorkbenchConversationCard;
  column: (typeof COLUMNS)[number];
  onOpen: () => void;
}) {
  const t = useI18n();
  return (
    <button
      type="button"
      className={styles.card}
      data-attention={
        card.column !== 'done' &&
        (card.attentionReasons.length > 0 ||
          (card.scopeType === 'work_order' &&
            (card.workOrderMissingRequiredCount ?? 0) > 0))
      }
      onClick={onOpen}
    >
      <span className={styles.cardTop}>
        <span className={styles.cardType}>
          {card.scopeType === 'work_order'
            ? t['com.affine.localmind.workbench.v9.personalWorkOrder']()
            : 'AI'}
        </span>
        <span className={styles.cardStatus} data-column={column.id}>
          {t[column.titleKey]()}
        </span>
      </span>
      <span className={styles.cardTitle} title={card.title ?? undefined}>
        {card.title?.trim() ||
          t['com.affine.localmind.workbench.v9.untitled']()}
      </span>
      <span
        className={styles.cardMeta}
        title={
          card.scopeType === 'work_order'
            ? [card.workOrderSenderName, card.workOrderSourceProjectName]
                .filter(Boolean)
                .join(' · ')
            : (card.project?.name ?? undefined)
        }
      >
        {card.scopeType === 'work_order'
          ? [
              card.workOrderSenderName
                ? t['com.affine.localmind.workbench.v9.sentBy']({
                    name: card.workOrderSenderName,
                  })
                : null,
              card.workOrderSourceProjectName
                ? `${t['com.affine.localmind.workbench.v9.sourceProject']()}：${card.workOrderSourceProjectName}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : card.scopeType === 'workspace'
            ? t['com.affine.localmind.workbench.v9.graphWorkspaceSource']()
            : `${t['com.affine.localmind.workbench.v9.projectFilter']()} · ${card.project?.name ?? ''}`}
      </span>
      {card.scopeType === 'work_order' &&
      card.workOrderRequiredReturnTitles.length ? (
        <span
          className={styles.cardMeta}
          title={card.workOrderRequiredReturnTitles.join(' · ')}
        >
          {t['com.affine.localmind.workbench.v9.returnItems']()}：
          {card.workOrderRequiredReturnTitles.join(' · ')}
        </span>
      ) : null}
      {card.scopeType === 'work_order' && card.column !== 'done' ? (
        <span className={styles.reason}>
          {card.workOrderMissingRequiredCount
            ? t['com.affine.localmind.workbench.v9.missingRequired']({
                count: String(card.workOrderMissingRequiredCount),
              })
            : t['com.affine.localmind.workbench.v9.reviewRequired']()}
        </span>
      ) : null}
      {card.attentionReasons.length ? (
        <span className={styles.reasons}>
          {card.attentionReasons.map(reason => (
            <span key={reason} className={styles.reason}>
              {attentionLabel(reason, t)}
            </span>
          ))}
        </span>
      ) : null}
      <span className={styles.cardFooter}>
        <span
          className={styles.cardAvatar}
          data-kind={card.scopeType === 'work_order' ? 'person' : 'ai'}
          aria-hidden="true"
        >
          {card.scopeType === 'work_order'
            ? card.workOrderSenderName?.trim().slice(0, 1) || '—'
            : 'AI'}
        </span>
        <span>{new Date(card.lastBusinessAt).toLocaleString()}</span>
        {card.activeRunCount ? (
          <span>
            {card.activeRunCount}{' '}
            {t['com.affine.localmind.workbench.v9.activeRuns']()}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ConversationBoard({
  cards,
  filteredCards,
  filter,
  onFilterChange,
  projects,
  projectsResolved = false,
  onOpenCard,
  onOpenRelation,
  onNewConversation,
  onSignIn,
  workspaceExpanded,
  onWorkspaceExpandedChange,
}: ConversationBoardProps) {
  const t = useI18n();
  const [view, setView] = useState<'items' | 'relations'>('items');
  const [activeColumn, setActiveColumn] =
    useState<WorkbenchConversationColumn>('todo');
  const [localFilter, setLocalFilter] = useState('');
  const projectFilter = filter ?? localFilter;
  const setProjectFilter = (value: string) => {
    setLocalFilter(value);
    onFilterChange?.(value);
  };
  const displayedCards = projectFilter && filteredCards ? filteredCards : cards;
  const [relationProjects, setRelationProjects] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const filterProjects =
    view === 'relations'
      ? [
          ...projects,
          ...relationProjects.filter(
            relationProject =>
              !projects.some(project => project.id === relationProject.id)
          ),
        ]
      : projects;

  if (COLUMNS.some(column => cards[column.id].authenticationRequired)) {
    return (
      <section className={styles.root} aria-labelledby="workbench-board-title">
        <div className={styles.shell}>
          <header className={styles.header}>
            <div>
              <h1 id="workbench-board-title" className={styles.title}>
                {t['com.affine.localmind.workbench.v9.overview']()}
              </h1>
              <p className={styles.subtitle} role="status">
                {t['com.affine.localmind.workbench.fusion.signInRequired']()}
              </p>
              {onSignIn ? (
                <Button onClick={onSignIn}>
                  {t['com.affine.localmind.workbench.fusion.signIn']()}
                </Button>
              ) : null}
            </div>
          </header>
        </div>
      </section>
    );
  }

  return (
    <section
      className={styles.root}
      data-expanded={workspaceExpanded}
      data-view={view}
      aria-labelledby={view === 'items' ? 'workbench-board-title' : undefined}
      aria-label={
        view === 'relations'
          ? t['com.affine.localmind.workbench.orbit.title']()
          : undefined
      }
    >
      <div className={styles.topline}>
        <div className={styles.path}>
          {t['com.affine.localmind.workbench.v9.overview']()} /{' '}
          {filterProjects.find(project => project.id === projectFilter)?.name ??
            t[
              projectFilter === 'work_order'
                ? 'com.affine.localmind.workbench.v9.personalWorkOrder'
                : 'com.affine.localmind.workbench.v9.allProjects'
            ]()}
        </div>
        <div className={styles.controls}>
          {view === 'relations' && (
            <button
              type="button"
              className={styles.mobileNewConversation}
              onClick={onNewConversation}
            >
              <PlusIcon />
              {t['com.affine.localmind.workbench.v9.newConversation']()}
            </button>
          )}
          <button
            type="button"
            className={styles.filterButton}
            aria-pressed={workspaceExpanded}
            aria-controls="intelligence-project-navigation"
            onClick={() => onWorkspaceExpandedChange(!workspaceExpanded)}
          >
            <SidebarIcon />
            {t[
              workspaceExpanded
                ? 'com.affine.localmind.workbench.v9.graphRestoreWorkspace'
                : 'com.affine.localmind.workbench.v9.graphExpandWorkspace'
            ]()}
          </button>
          <div className={styles.segmented} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'items'}
              onClick={() => setView('items')}
            >
              <span className={styles.modeIconList} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {t['com.affine.localmind.workbench.v9.items']()}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'relations'}
              onClick={() => setView('relations')}
            >
              <span className={styles.modeIconMap} aria-hidden="true">
                <i />
              </span>
              {t['com.affine.localmind.workbench.v9.relations']()}
            </button>
          </div>
          <label className={styles.projectFilter}>
            <span className={styles.visuallyHidden}>
              {t['com.affine.localmind.workbench.v9.projectFilter']()}
            </span>
            <select
              value={projectFilter}
              title={
                filterProjects.find(project => project.id === projectFilter)
                  ?.name ??
                t[
                  projectFilter === 'work_order'
                    ? 'com.affine.localmind.workbench.v9.personalWorkOrder'
                    : 'com.affine.localmind.workbench.v9.allProjects'
                ]()
              }
              onChange={event => setProjectFilter(event.currentTarget.value)}
            >
              <option value="">
                {t['com.affine.localmind.workbench.v9.allProjects']()}
              </option>
              {filterProjects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
              <option value="work_order">
                {t['com.affine.localmind.workbench.v9.personalWorkOrder']()}
              </option>
            </select>
            <span aria-hidden="true">⌄</span>
          </label>
        </div>
      </div>
      <div className={styles.shell}>
        {view === 'items' && (
          <header className={styles.header}>
            <div>
              <h1 id="workbench-board-title" className={styles.title}>
                {t['com.affine.localmind.workbench.v9.overview']()}
              </h1>
              <p className={styles.subtitle}>
                {t[
                  'com.affine.localmind.workbench.fusion.overviewDescription'
                ]()}
              </p>
            </div>
            <button
              type="button"
              className={styles.mobileNewConversation}
              onClick={onNewConversation}
            >
              <PlusIcon />
              {t['com.affine.localmind.workbench.v9.newConversation']()}
            </button>
          </header>
        )}
        <div className={styles.stage}>
          {view === 'relations' ? (
            <CollaborationOrbitBoard
              workspaceExpanded={workspaceExpanded}
              projectFilter={projectFilter}
              onOpenRelation={onOpenRelation}
              onProjectsChange={setRelationProjects}
            />
          ) : (
            <>
              <div
                className={styles.columnSwitch}
                role="tablist"
                aria-label={t['com.affine.localmind.workbench.v9.items']()}
              >
                {COLUMNS.map((column, index) => (
                  <button
                    key={column.id}
                    type="button"
                    role="tab"
                    aria-selected={activeColumn === column.id}
                    tabIndex={activeColumn === column.id ? 0 : -1}
                    aria-controls={'workbench-column-' + column.id}
                    onClick={() => setActiveColumn(column.id)}
                    onKeyDown={event => {
                      if (
                        event.key !== 'ArrowLeft' &&
                        event.key !== 'ArrowRight'
                      )
                        return;
                      event.preventDefault();
                      const next =
                        (index + (event.key === 'ArrowRight' ? 1 : 2)) %
                        COLUMNS.length;
                      setActiveColumn(COLUMNS[next].id);
                      event.currentTarget.parentElement
                        ?.querySelectorAll<HTMLButtonElement>('button')
                        [next]?.focus();
                    }}
                  >
                    {t[column.titleKey]()}{' '}
                    {displayedCards.counts?.[column.id] ?? '—'}
                  </button>
                ))}
              </div>
              <div className={styles.columns}>
                {COLUMNS.map(column => {
                  const state = displayedCards[column.id];
                  const visible = state.items.filter(card =>
                    projectsResolved &&
                    card.scopeType === 'project' &&
                    !projects.some(
                      project =>
                        project.id === card.project?.id &&
                        project.status === 'active'
                    )
                      ? false
                      : projectFilter === 'work_order'
                        ? card.scopeType === 'work_order'
                        : projectFilter
                          ? card.project?.id === projectFilter
                          : true
                  );
                  return (
                    <section
                      key={column.id}
                      id={'workbench-column-' + column.id}
                      data-mobile-active={activeColumn === column.id}
                      className={styles.column}
                      aria-labelledby={`workbench-${column.id}`}
                    >
                      <h2
                        id={`workbench-${column.id}`}
                        className={styles.columnTitle}
                        title={t[
                          column.id === 'todo'
                            ? 'com.affine.localmind.workbench.v9.todoHint'
                            : column.id === 'progress'
                              ? 'com.affine.localmind.workbench.v9.progressHint'
                              : 'com.affine.localmind.workbench.v9.doneHint'
                        ]()}
                      >
                        <span>{t[column.titleKey]()}</span>
                        <span className={styles.count}>
                          {displayedCards.counts?.[column.id] ?? '—'}
                        </span>
                      </h2>

                      <div className={styles.cardList}>
                        {state.loading && !visible.length ? (
                          <div className={styles.state}>
                            <Loading size={24} />
                          </div>
                        ) : state.error && !visible.length ? (
                          <div className={styles.state} role="alert">
                            <span>{projectErrorMessage(state.error)}</span>
                            <Button onClick={() => void state.refresh()}>
                              {t['Retry']()}
                            </Button>
                          </div>
                        ) : visible.length ? (
                          groupCards(visible).map(group => (
                            <Fragment key={group.kind}>
                              {group.label ? (
                                <div className={styles.sectionLabel}>
                                  {t[group.label]()}
                                </div>
                              ) : null}
                              {group.cards.map(card => (
                                <Card
                                  key={card.sessionId}
                                  card={card}
                                  column={column}
                                  onOpen={() => onOpenCard(card)}
                                />
                              ))}
                            </Fragment>
                          ))
                        ) : (
                          <div className={styles.state}>
                            {t[
                              'com.affine.localmind.workbench.v9.columnEmpty'
                            ]()}
                          </div>
                        )}
                        {state.error && visible.length ? (
                          <div className={styles.state} role="alert">
                            <span>{projectErrorMessage(state.error)}</span>
                            <Button
                              onClick={() =>
                                void (state.retry ?? state.refresh)()
                              }
                            >
                              {t['Retry']()}
                            </Button>
                          </div>
                        ) : null}
                        {state.hasNextPage ? (
                          <Button
                            loading={state.loadingMore}
                            onClick={() => void state.loadMore()}
                          >
                            {t['Load more']()}
                          </Button>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
