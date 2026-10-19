import { Loading, notify, useConfirmModal } from '@affine/component';
import {
  getNewReportDeckPath,
  getReportDeckPath,
  getReportDecksPath,
} from '@affine/core/desktop/route-paths';
import { useReportDeckApi } from '@affine/core/modules/report-decks/api';
import {
  useDeck,
  useDeckCommand,
  useDeckHtml,
} from '@affine/core/modules/report-decks/hooks';
import {
  useDeckLanguage,
  useDeckText,
} from '@affine/core/modules/report-decks/i18n';
import type {
  DeckDetail,
  DeckPhase,
} from '@affine/core/modules/report-decks/types';
import {
  ArrowLeftSmallIcon,
  CloseIcon,
  DeleteIcon,
  DoneIcon,
  DownloadIcon,
  PlayIcon,
  RedoIcon,
  ShareIcon,
} from '@blocksuite/icons/rc';
import {
  type DeckDisplayMode,
  setDeckDisplayMode,
} from '@localmind/office/report-deck';
import { nanoid } from 'nanoid';
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

import {
  deckErrorMessage,
  deckProgressPercent,
  DeckStatusChip,
  formatChars,
  formatDeckTime,
  SourceKindIcon,
} from './deck-ui';
import * as styles from './report-decks.css';
import { ShareDialog } from './share-dialog';
import { useGalleryTemplates } from './template-gallery';

const STEPS: { key: string; phases: DeckPhase[] }[] = [
  { key: 'sources', phases: ['queued', 'sources'] },
  { key: 'extract', phases: ['extract'] },
  { key: 'compose', phases: ['compose'] },
  { key: 'render', phases: ['render', 'done'] },
];

function stepIndex(deck: DeckDetail) {
  if (deck.status === 'queued') return -1;
  return STEPS.findIndex(step => step.phases.includes(deck.progress.phase));
}

type DeckFrameHandle = { enterPresentation: () => void };

/** The generated deck. No same-origin: the HTML cannot reach cookies or APIs. */
export function DeckFrame({
  ref,
  html,
  title,
  mode = 'read',
  onExit,
}: {
  ref?: Ref<DeckFrameHandle>;
  html: string;
  title: string;
  mode?: DeckDisplayMode;
  onExit?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [immersive, setImmersive] = useState(mode === 'present');
  const immersiveRef = useRef(immersive);
  const wasFullscreen = useRef(false);
  const requesting = useRef(false);
  const exitCallback = useRef(onExit);
  exitCallback.current = onExit;
  const sendFullscreenState = useCallback(
    (error?: 'unsupported' | 'failed') => {
      frame.current?.contentWindow?.postMessage(
        {
          type: 'localmind-deck-fullscreen-state',
          active: document.fullscreenElement === frame.current,
          immersive: immersiveRef.current,
          error,
        },
        '*'
      );
    },
    []
  );
  const leavePresentation = useCallback(() => {
    if (!immersiveRef.current) return;
    immersiveRef.current = false;
    setImmersive(false);
    sendFullscreenState();
    exitCallback.current?.();
  }, [sendFullscreenState]);
  const exitPresentation = useCallback(() => {
    leavePresentation();
    if (document.fullscreenElement === frame.current)
      void document.exitFullscreen().catch(() => {});
  }, [leavePresentation]);
  const enterPresentation = useCallback(async () => {
    if (requesting.current || !frame.current) return;
    immersiveRef.current = true;
    setImmersive(true);
    sendFullscreenState();
    if (!frame.current.requestFullscreen) {
      sendFullscreenState('unsupported');
      return;
    }
    requesting.current = true;
    try {
      // Fullscreen the HTML itself, never the surrounding application shell.
      await frame.current.requestFullscreen();
      sendFullscreenState();
    } catch {
      sendFullscreenState('failed');
    } finally {
      requesting.current = false;
    }
  }, [sendFullscreenState]);
  useImperativeHandle(
    ref,
    () => ({
      enterPresentation: () => {
        void enterPresentation().catch(() => sendFullscreenState('failed'));
      },
    }),
    [enterPresentation, sendFullscreenState]
  );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'localmind-deck-exit') exitPresentation();
      else if (event.data?.type === 'localmind-deck-ready')
        sendFullscreenState();
      else if (event.data?.type === 'localmind-deck-fullscreen-toggle') {
        if (immersiveRef.current) exitPresentation();
        else
          void enterPresentation().catch(() => sendFullscreenState('failed'));
      }
    };
    const fullscreenChanged = () => {
      const active = document.fullscreenElement === frame.current;
      // Browsers may consume Escape before keydown reaches either document.
      if (wasFullscreen.current && !active) leavePresentation();
      wasFullscreen.current = active;
      sendFullscreenState();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && immersiveRef.current) {
        event.preventDefault();
        exitPresentation();
      }
    };
    window.addEventListener('message', receive);
    window.addEventListener('keydown', keydown);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    return () => {
      window.removeEventListener('message', receive);
      window.removeEventListener('keydown', keydown);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
    };
  }, [
    enterPresentation,
    exitPresentation,
    leavePresentation,
    sendFullscreenState,
  ]);
  return (
    <iframe
      ref={frame}
      className={styles.frame}
      data-immersive={immersive || undefined}
      title={title}
      sandbox="allow-scripts"
      allow="fullscreen"
      srcDoc={setDeckDisplayMode(html, mode)}
      onLoad={() => sendFullscreenState()}
      data-testid="deck-frame"
    />
  );
}

function GeneratingState({
  deck,
  onCancel,
  cancelling,
}: {
  deck: DeckDetail;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const t = useDeckText();
  const current = stepIndex(deck);
  const percent = deckProgressPercent(deck.status, deck.progress);
  return (
    <div className={styles.statusPanel} data-testid="deck-generating">
      <p className={styles.eyebrow}>
        <span className={styles.brandDot} aria-hidden="true" />
        {t(deck.status === 'queued' ? 'viewer.queued' : 'viewer.generating')}
      </p>
      <h2 className={styles.pageTitle} style={{ fontSize: 24 }}>
        {deck.title || t('untitledGenerating')}
      </h2>
      <ol className={styles.steps}>
        {STEPS.map((step, index) => {
          const state =
            index < current ? 'done' : index === current ? 'active' : 'pending';
          return (
            <li key={step.key} className={styles.step} data-state={state}>
              <span className={styles.stepMark} aria-hidden="true">
                {state === 'done' ? (
                  <DoneIcon width={14} height={14} />
                ) : (
                  index + 1
                )}
              </span>
              <span>{t(`viewer.step.${step.key}`)}</span>
              {state === 'active' && deck.progress.total > 0 && (
                <span className={styles.muted}>
                  {deck.progress.done}/{deck.progress.total}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {deck.progress.subphase && (
        <p role="status" className={styles.muted}>
          {t(`viewer.subphase.${deck.progress.subphase}`)}
        </p>
      )}
      {!deck.progress.subphase && (
        <div
          className={styles.bigProgress}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={deck.progress.subphase ? undefined : percent}
          aria-valuetext={
            deck.progress.subphase
              ? t(`viewer.subphase.${deck.progress.subphase}`)
              : undefined
          }
          aria-label={t('status.generating')}
        >
          <span
            className={styles.progressFill}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <div className={styles.row} style={{ marginTop: 20 }}>
        <p className={styles.muted}>{t('viewer.generatingHint')}</p>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.button}
          disabled={cancelling}
          onClick={onCancel}
        >
          <CloseIcon />
          {t('action.cancelGeneration')}
        </button>
      </div>
    </div>
  );
}

function FailedState({
  deck,
  busy,
  onRetry,
  onReconfigure,
}: {
  deck: DeckDetail;
  busy: boolean;
  onRetry: () => void;
  onReconfigure: () => void;
}) {
  const t = useDeckText();
  const cancelled = deck.status === 'cancelled';
  return (
    <div className={styles.statusPanel} role="alert" data-testid="deck-failed">
      <p className={styles.eyebrow}>
        {t(cancelled ? 'status.cancelled' : 'status.failed')}
      </p>
      <h2 className={styles.pageTitle} style={{ fontSize: 24 }}>
        {deck.title || t('untitled')}
      </h2>
      <p className={styles.pageLead}>
        {cancelled
          ? t('viewer.cancelledDescription')
          : deckErrorMessage(deck.errorCode, t)}
      </p>
      <div className={styles.row} style={{ marginTop: 24 }}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={busy}
          onClick={onRetry}
        >
          <RedoIcon />
          {t(cancelled ? 'action.regenerate' : 'action.retry')}
        </button>
        <button type="button" className={styles.button} onClick={onReconfigure}>
          {t('action.reconfigure')}
        </button>
      </div>
    </div>
  );
}

function SourcesPanel({ deck }: { deck: DeckDetail }) {
  const t = useDeckText();
  const language = useDeckLanguage();
  const { templates } = useGalleryTemplates();
  const template = templates.find(item => item.key === deck.templateKey);
  return (
    <aside className={styles.sourcesPanel} aria-label={t('viewer.sources')}>
      <h2 className={styles.panelHeading}>{t('viewer.details')}</h2>
      <div className={styles.aiMeta}>
        <span className={styles.pill}>
          {deck.mode === 'custom'
            ? t('mode.custom')
            : `${t('mode.template')} · ${template?.name ?? deck.templateKey ?? ''}`}
        </span>
        {deck.slideCount ? (
          <span className={styles.pill}>
            {t('history.slides', { count: deck.slideCount })}
          </span>
        ) : null}
      </div>
      <p className={styles.muted}>
        {t('viewer.aiUsed', {
          scope: deck.ai.scopeLabel || deck.ai.scopeId,
          model: deck.modelId ?? '—',
        })}
      </p>
      <p className={styles.muted}>
        {t('viewer.createdAt', {
          time: formatDeckTime(deck.createdAt, language),
        })}
      </p>
      <h2 className={styles.panelHeading}>
        {t('viewer.sourcesCount', { count: deck.sources.length })}
      </h2>
      <ul className={styles.sourceList}>
        {deck.sources.map((source, index) => (
          <li
            key={`${source.scopeKind}:${source.scopeId}:${source.resourceId ?? ''}:${index}`}
            className={styles.sourceRow}
            data-excluded={source.status === 'excluded' || undefined}
          >
            <SourceKindIcon kind={source.kind} />
            <span className={styles.sourceTitle}>
              <strong>{source.title || t('untitled')}</strong>
              <span>
                {source.status === 'excluded'
                  ? t(`source.reason.${source.reason ?? 'unsupported'}`)
                  : source.status === 'truncated'
                    ? t('source.truncated')
                    : source.chars
                      ? `${source.scopeLabel} · ${formatChars(source.chars, t, language)}`
                      : source.scopeLabel}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ReadyCanvas({
  deck,
  presentationRef,
}: {
  deck: DeckDetail;
  presentationRef: Ref<DeckFrameHandle>;
}) {
  const t = useDeckText();
  const html = useDeckHtml(deck);
  return (
    <div className={styles.viewerCanvas} style={{ flexDirection: 'column' }}>
      {!!deck.quality?.warnings.length && (
        <div
          className={styles.muted}
          role="status"
          data-testid="deck-quality"
          style={{ padding: '12px 16px' }}
        >
          {deck.quality.warnings.map(warning => (
            <p key={warning}>{t(`quality.${warning}`)}</p>
          ))}
        </div>
      )}
      <div className={styles.deckStage} style={{ flex: 1, height: 'auto' }}>
        {html.html ? (
          <DeckFrame
            ref={presentationRef}
            html={html.html}
            title={deck.title || t('untitled')}
          />
        ) : html.error ? (
          <div className={styles.gate} role="alert">
            <p>{t('viewer.htmlFailed')}</p>
            <button
              type="button"
              className={styles.button}
              onClick={() => void html.refresh()}
            >
              {t('action.retry')}
            </button>
          </div>
        ) : (
          <div
            className={styles.row}
            style={{ height: '100%', justifyContent: 'center' }}
          >
            <Loading />
          </div>
        )}
      </div>
    </div>
  );
}

export function DeckViewer({ deckId }: { deckId: string }) {
  const t = useDeckText();
  const navigate = useNavigate();
  const api = useReportDeckApi();
  const { openConfirmModal } = useConfirmModal();
  const { deck, error, loading, refresh } = useDeck(deckId);
  const command = useDeckCommand();
  const [shareOpen, setShareOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const presentation = useRef<DeckFrameHandle | null>(null);
  const [presentationReady, setPresentationReady] = useState(false);
  const bindPresentation = useCallback((handle: DeckFrameHandle | null) => {
    presentation.current = handle;
    setPresentationReady(!!handle);
  }, []);
  const run = async (input: Parameters<typeof command.run>[0]) => {
    try {
      return await command.run(input);
    } catch {
      notify.error({ title: t('error.commandFailed') });
      return null;
    }
  };
  const regenerate = async () => {
    const result = await run({
      operation: 'regenerate',
      deckId,
      requestKey: nanoid(),
    });
    if (result?.deck) navigate(getReportDeckPath(result.deck.id));
  };
  const reconfigure = () =>
    navigate(
      `${getNewReportDeckPath()}?${new URLSearchParams({ from: deckId })}`
    );
  const remove = () =>
    openConfirmModal({
      title: t('delete.title'),
      description: t('delete.description', {
        title: deck?.title || t('untitled'),
      }),
      confirmText: t('action.delete'),
      confirmButtonOptions: { variant: 'error' },
      onConfirm: async () => {
        const result = await run({ operation: 'delete', deckId });
        if (result) navigate(getReportDecksPath());
      },
    });

  if (!deck)
    return (
      <div className={styles.viewerCanvas} style={{ flex: 1 }}>
        {loading ? (
          <Loading />
        ) : (
          <div className={styles.statusPanel} role="alert">
            <h2 className={styles.cardTitle}>
              {t(error ? 'viewer.loadFailed' : 'viewer.notFound')}
            </h2>
            <p className={styles.pageLead}>
              {t(
                error
                  ? 'viewer.loadFailedDescription'
                  : 'viewer.notFoundDescription'
              )}
            </p>
            <div className={styles.row} style={{ marginTop: 20 }}>
              {error ? (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void refresh()}
                >
                  {t('action.retry')}
                </button>
              ) : null}
              <button
                type="button"
                className={styles.button}
                onClick={() => navigate(getReportDecksPath())}
              >
                {t('action.backHome')}
              </button>
            </div>
          </div>
        )}
      </div>
    );

  const active = deck.status === 'queued' || deck.status === 'generating';
  const ready = deck.status === 'ready';
  return (
    <>
      <header className={styles.viewerBar}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('action.backHome')}
          title={t('action.backHome')}
          onClick={() => navigate(getReportDecksPath())}
        >
          <ArrowLeftSmallIcon />
        </button>
        <div className={styles.viewerTitle}>
          <h1>{deck.title || t(active ? 'untitledGenerating' : 'untitled')}</h1>
          <div className={styles.row}>
            <DeckStatusChip
              status={deck.status}
              progress={deck.progress}
              t={t}
            />
          </div>
        </div>
        {ready && (
          <>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!presentationReady}
              onClick={() => presentation.current?.enterPresentation()}
            >
              <PlayIcon />
              {t('action.present')}
            </button>
            <a
              className={styles.button}
              href={api.htmlUrl(deck.id, true)}
              download
            >
              <DownloadIcon />
              {t('action.download')}
            </a>
            <button
              type="button"
              className={styles.button}
              onClick={() => setShareOpen(true)}
            >
              <ShareIcon />
              {t('action.share')}
            </button>
          </>
        )}
        {!active && (
          <button
            type="button"
            className={styles.button}
            disabled={command.pending}
            onClick={() => void regenerate()}
          >
            <RedoIcon />
            {t('action.regenerateSame')}
          </button>
        )}
        <button
          type="button"
          className={styles.ghostButton}
          aria-pressed={panelOpen}
          onClick={() => setPanelOpen(value => !value)}
        >
          {t('viewer.sources')}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('action.delete')}
          title={t('action.delete')}
          disabled={command.pending}
          onClick={remove}
        >
          <DeleteIcon />
        </button>
      </header>
      <div className={styles.viewerBody}>
        {ready ? (
          <ReadyCanvas deck={deck} presentationRef={bindPresentation} />
        ) : (
          <div className={styles.viewerCanvas}>
            {active ? (
              <GeneratingState
                deck={deck}
                cancelling={command.pending}
                onCancel={() => void run({ operation: 'cancel', deckId })}
              />
            ) : (
              <FailedState
                deck={deck}
                busy={command.pending}
                onRetry={() =>
                  void (deck.status === 'cancelled'
                    ? regenerate()
                    : run({ operation: 'retry', deckId }))
                }
                onReconfigure={reconfigure}
              />
            )}
          </div>
        )}
        {panelOpen && <SourcesPanel deck={deck} />}
      </div>
      {ready && (
        <ShareDialog
          deck={deck}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
        />
      )}
    </>
  );
}

/** `/reports/:deckId/present`: the deck alone, edge to edge. */
export function DeckPresent({ deckId }: { deckId: string }) {
  const t = useDeckText();
  const navigate = useNavigate();
  const { deck, loading } = useDeck(deckId);
  const html = useDeckHtml(deck);
  const exit = useCallback(() => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {});
    navigate(getReportDeckPath(deckId));
  }, [deckId, navigate]);
  useEffect(() => {
    if (html.html) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exit();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [exit, html.html]);
  return (
    <div className={styles.presentRoot}>
      {html.html ? (
        <DeckFrame
          html={html.html}
          title={deck?.title || t('untitled')}
          mode="present"
          onExit={exit}
        />
      ) : (
        <div
          className={styles.gate}
          style={{ position: 'absolute', inset: 0, height: 'fit-content' }}
        >
          {loading || html.loading ? (
            <Loading />
          ) : (
            <p role="alert">{t('viewer.presentUnavailable')}</p>
          )}
        </div>
      )}
    </div>
  );
}
