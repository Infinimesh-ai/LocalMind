import { Button, Loading } from '@affine/component';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { useI18n } from '@affine/i18n';
import { PlusIcon, SidebarIcon } from '@blocksuite/icons/rc';
import { useState } from 'react';

import { CollaborationOrbitBoard } from './collaboration-orbit-board';
import * as styles from './conversation-board.css';
import type {
  WorkbenchCollaborationGraph,
  WorkbenchConversationCard,
  WorkbenchConversationColumn,
  WorkbenchProject,
} from './types';
import type { ConversationCardsState } from './use-conversation-cards';

type ConversationBoardProps = {
  cards: ConversationCardsState;
  projects: WorkbenchProject[];
  onOpenCard: (card: WorkbenchConversationCard) => void;
  onOpenRelation: (
    relation: WorkbenchCollaborationGraph['edges'][number]
  ) => void | Promise<void>;
  onNewConversation: () => void;
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
    <button type="button" className={styles.card} onClick={onOpen}>
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
      <span className={styles.cardTitle}>
        {card.title?.trim() ||
          t['com.affine.localmind.workbench.v9.untitled']()}
      </span>
      <span className={styles.cardMeta}>
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
        <span className={styles.cardMeta}>
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
              {reason}
            </span>
          ))}
        </span>
      ) : null}
      <span className={styles.cardFooter}>
        <span className={styles.cardAvatar} aria-hidden="true">
          AI
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
  projects,
  onOpenCard,
  onOpenRelation,
  onNewConversation,
  workspaceExpanded,
  onWorkspaceExpandedChange,
}: ConversationBoardProps) {
  const t = useI18n();
  const [view, setView] = useState<'items' | 'relations'>('items');
  const [projectFilter, setProjectFilter] = useState('');
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

  return (
    <section
      className={styles.root}
      data-expanded={workspaceExpanded}
      data-view={view}
      aria-labelledby="workbench-board-title"
    >
      <div className={styles.shell}>
        <div className={styles.topline}>
          <div className={styles.controls}>
            {view === 'relations' && (
              <Button
                className={styles.workspaceToggle}
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
              </Button>
            )}
            <div className={styles.segmented} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'items'}
                onClick={() => {
                  setView('items');
                  onWorkspaceExpandedChange(false);
                }}
              >
                {t['com.affine.localmind.workbench.v9.items']()}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'relations'}
                onClick={() => setView('relations')}
              >
                {t['com.affine.localmind.workbench.v9.relations']()}
              </button>
            </div>
            <label className={styles.filter}>
              <span>
                {t['com.affine.localmind.workbench.v9.projectFilter']()}
              </span>
              <select
                value={projectFilter}
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
            </label>
          </div>
        </div>
        {view === 'items' && (
          <header className={styles.header}>
            <div>
              <h1 id="workbench-board-title" className={styles.title}>
                {t['com.affine.localmind.workbench.v9.overview']()}
              </h1>
              <p className={styles.subtitle}>
                {t['com.affine.localmind.workbench.v9.overviewDescription']()}
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
        {view === 'relations' ? (
          <CollaborationOrbitBoard
            workspaceExpanded={workspaceExpanded}
            projectFilter={projectFilter}
            onOpenRelation={onOpenRelation}
            onProjectsChange={setRelationProjects}
          />
        ) : (
          <div className={styles.columns}>
            {COLUMNS.map(column => {
              const state = cards[column.id];
              const visible = state.items.filter(card =>
                projectFilter === 'work_order'
                  ? card.scopeType === 'work_order'
                  : projectFilter
                    ? card.project?.id === projectFilter
                    : true
              );
              return (
                <section
                  key={column.id}
                  className={styles.column}
                  aria-labelledby={`workbench-${column.id}`}
                >
                  <h2
                    id={`workbench-${column.id}`}
                    className={styles.columnTitle}
                  >
                    <span>{t[column.titleKey]()}</span>
                    <span className={styles.count}>
                      {projectFilter
                        ? visible.length
                        : (cards.counts?.[column.id] ?? visible.length)}
                    </span>
                  </h2>
                  <p className={styles.columnHint}>
                    {t[
                      column.id === 'todo'
                        ? 'com.affine.localmind.workbench.v9.todoHint'
                        : column.id === 'progress'
                          ? 'com.affine.localmind.workbench.v9.progressHint'
                          : 'com.affine.localmind.workbench.v9.doneHint'
                    ]()}
                  </p>
                  <div className={styles.cardList}>
                    {state.loading ? (
                      <div className={styles.state}>
                        <Loading size={24} />
                      </div>
                    ) : state.error ? (
                      <div className={styles.state} role="alert">
                        <span>{projectErrorMessage(state.error)}</span>
                        <Button onClick={() => void state.refresh()}>
                          {t['Retry']()}
                        </Button>
                      </div>
                    ) : visible.length ? (
                      visible.map(card => (
                        <Card
                          key={card.sessionId}
                          card={card}
                          column={column}
                          onOpen={() => onOpenCard(card)}
                        />
                      ))
                    ) : (
                      <div className={styles.state}>
                        {t['com.affine.localmind.workbench.v9.columnEmpty']()}
                      </div>
                    )}
                    {state.hasNextPage && !projectFilter ? (
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
        )}
      </div>
    </section>
  );
}
