import { Button, Loading } from '@affine/component';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { useI18n } from '@affine/i18n';
import { useMemo, useState } from 'react';

import { CollaborationGraph } from './collaboration-graph';
import * as styles from './conversation-board.css';
import type {
  WorkbenchConversationCard,
  WorkbenchConversationColumn,
  WorkbenchProject,
} from './types';
import type { ConversationCardsState } from './use-conversation-cards';

type ConversationBoardProps = {
  cards: ConversationCardsState;
  projects: WorkbenchProject[];
  onOpenCard: (card: WorkbenchConversationCard) => void;
  onNewConversation: () => void;
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
  onOpen,
}: {
  card: WorkbenchConversationCard;
  onOpen: () => void;
}) {
  const t = useI18n();
  return (
    <button type="button" className={styles.card} onClick={onOpen}>
      <span className={styles.cardTitle}>{card.title}</span>
      <span className={styles.cardMeta}>
        {card.scopeType === 'work_order'
          ? t['com.affine.localmind.workbench.v9.personalWorkOrder']()
          : card.project?.name}
      </span>
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
  onNewConversation,
}: ConversationBoardProps) {
  const t = useI18n();
  const [view, setView] = useState<'items' | 'relations'>('items');
  const [projectFilter, setProjectFilter] = useState('');
  const allCards = useMemo(
    () => [...cards.todo.items, ...cards.progress.items, ...cards.done.items],
    [cards]
  );

  return (
    <section className={styles.root} aria-labelledby="workbench-board-title">
      <header className={styles.header}>
        <div>
          <h1 id="workbench-board-title" className={styles.title}>
            {t['com.affine.localmind.workbench.v9.overview']()}
          </h1>
          <p className={styles.subtitle}>
            {t['com.affine.localmind.workbench.v9.overviewDescription']()}
          </p>
        </div>
        <Button variant="primary" onClick={onNewConversation}>
          {t['com.affine.localmind.workbench.v9.newConversation']()}
        </Button>
      </header>
      <div className={styles.controls}>
        <div className={styles.segmented} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'items'}
            onClick={() => setView('items')}
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
          <span>{t['com.affine.localmind.workbench.v9.projectFilter']()}</span>
          <select
            value={projectFilter}
            onChange={event => setProjectFilter(event.currentTarget.value)}
          >
            <option value="">
              {t['com.affine.localmind.workbench.v9.allProjects']()}
            </option>
            {projects.map(project => (
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
      {view === 'relations' ? (
        <CollaborationGraph cards={allCards} onOpenCard={onOpenCard} />
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
                    {cards.counts?.[column.id] ?? visible.length}
                  </span>
                </h2>
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
    </section>
  );
}
