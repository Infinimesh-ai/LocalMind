import { notify, useConfirmModal } from '@affine/component';
import { getReportDeckPath } from '@affine/core/desktop/route-paths';
import {
  useDeckCommand,
  useDeckList,
} from '@affine/core/modules/report-decks/hooks';
import {
  useDeckLanguage,
  useDeckText,
} from '@affine/core/modules/report-decks/i18n';
import type { DeckSummary } from '@affine/core/modules/report-decks/types';
import { DeleteIcon, HistoryIcon, RedoIcon } from '@blocksuite/icons/rc';
import { nanoid } from 'nanoid';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  deckProgressPercent,
  DeckStatusChip,
  EmptyGlyph,
  formatDeckTime,
} from './deck-ui';
import * as styles from './report-decks.css';
import { useGalleryTemplates } from './template-gallery';

export function HistoryList({ onCreate }: { onCreate: () => void }) {
  const t = useDeckText();
  const language = useDeckLanguage();
  const navigate = useNavigate();
  const { openConfirmModal } = useConfirmModal();
  const decks = useDeckList();
  const command = useDeckCommand();
  const { templates } = useGalleryTemplates();
  const templateNames = useMemo(
    () => new Map(templates.map(item => [item.key, item.name])),
    [templates]
  );
  const regenerate = async (deck: DeckSummary) => {
    try {
      const result = await command.run({
        operation: 'regenerate',
        deckId: deck.id,
        requestKey: nanoid(),
      });
      if (result.deck) navigate(getReportDeckPath(result.deck.id));
    } catch {
      notify.error({ title: t('error.commandFailed') });
    }
  };
  const remove = (deck: DeckSummary) =>
    openConfirmModal({
      title: t('delete.title'),
      description: t('delete.description', {
        title: deck.title || t('untitled'),
      }),
      confirmText: t('action.delete'),
      confirmButtonOptions: { variant: 'error' },
      onConfirm: async () => {
        try {
          await command.run({ operation: 'delete', deckId: deck.id });
        } catch {
          notify.error({ title: t('error.commandFailed') });
        }
      },
    });

  if (decks.loading)
    return (
      <ul
        className={styles.historyList}
        aria-busy="true"
        aria-label={t('history.title')}
      >
        {[0, 1, 2].map(index => (
          <li key={index} className={styles.skeletonRow} />
        ))}
      </ul>
    );
  if (decks.error && !decks.items.length)
    return (
      <div className={styles.emptyState} role="alert">
        <h3>{t('history.loadFailed')}</h3>
        <button
          type="button"
          className={styles.button}
          onClick={() => void decks.refresh()}
        >
          {t('action.retry')}
        </button>
      </div>
    );
  if (!decks.items.length)
    return (
      <div className={styles.emptyState}>
        <EmptyGlyph>
          <HistoryIcon />
        </EmptyGlyph>
        <h3>{t('history.emptyTitle')}</h3>
        <p>{t('history.emptyDescription')}</p>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onCreate}
        >
          {t('home.create')}
        </button>
      </div>
    );
  return (
    <div className={styles.stack}>
      <ul className={styles.historyList} aria-label={t('history.title')}>
        {decks.items.map(deck => {
          const active =
            deck.status === 'queued' || deck.status === 'generating';
          const percent = deckProgressPercent(deck.status, deck.progress);
          return (
            <li
              key={deck.id}
              className={styles.historyRow}
              data-testid="deck-row"
            >
              <button
                type="button"
                className={styles.historyMain}
                onClick={() => navigate(getReportDeckPath(deck.id))}
              >
                <span
                  className={styles.historyThumb}
                  data-status={deck.status}
                  aria-hidden="true"
                />
                <span className={styles.historyText}>
                  <span className={styles.historyTitle}>
                    {deck.title ||
                      t(active ? 'untitledGenerating' : 'untitled')}
                  </span>
                  <span className={styles.historyMeta}>
                    <span>
                      {deck.mode === 'custom'
                        ? t('mode.custom')
                        : `${t('mode.template')} · ${
                            (deck.templateKey &&
                              templateNames.get(deck.templateKey)) ||
                            deck.templateKey ||
                            ''
                          }`}
                    </span>
                    <span>
                      {deck.excludedCount
                        ? t('history.sourcesExcluded', {
                            count: deck.sourceCount,
                            excluded: deck.excludedCount,
                          })
                        : t('history.sources', { count: deck.sourceCount })}
                    </span>
                    {deck.status === 'ready' && deck.slideCount ? (
                      <span>
                        {t('history.slides', { count: deck.slideCount })}
                      </span>
                    ) : null}
                    <span>{formatDeckTime(deck.createdAt, language)}</span>
                  </span>
                </span>
              </button>
              <div className={styles.historyActions}>
                {deck.status === 'generating' && (
                  <span
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={t('status.generating')}
                  >
                    <span
                      className={styles.progressFill}
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                )}
                <DeckStatusChip
                  status={deck.status}
                  progress={deck.progress}
                  t={t}
                />
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('action.regenerate')}
                  title={t('action.regenerate')}
                  disabled={active || command.pending}
                  onClick={() => void regenerate(deck)}
                >
                  <RedoIcon />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t('action.delete')}
                  title={t('action.delete')}
                  disabled={command.pending}
                  onClick={() => remove(deck)}
                >
                  <DeleteIcon />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {decks.hasMore && (
        <div className={styles.row} style={{ justifyContent: 'center' }}>
          <button
            type="button"
            className={styles.button}
            disabled={decks.loadingMore}
            onClick={() => void decks.loadMore()}
          >
            {t(decks.loadingMore ? 'history.loadingMore' : 'history.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
