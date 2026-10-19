import { Button, Loading } from '@affine/component';
import {
  getProjectReportPath,
  getProjectReportPresentationPath,
} from '@affine/core/desktop/route-paths';
import type { ProjectReportApi } from '@affine/core/modules/project-reports/contracts';
import { useReportState } from '@affine/core/modules/project-reports/hooks';
import {
  paginateReport,
  presentationKey,
  readPresentationMessage,
} from '@affine/core/modules/project-reports/presentation';
import { isProjectAccessError } from '@affine/core/modules/project-resources/error';
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ReportAccessDenied } from './access';
import { useReportText } from './fields';
import { ReportSlide } from './render';
import * as styles from './reports.css';

export function ReportPresentation({
  api,
  projectId,
  reportId,
  presenter,
}: {
  api: ProjectReportApi;
  projectId: string;
  reportId: string;
  presenter: boolean;
}) {
  const t = useReportText();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const revisionId = params.get('revision') ?? '';
  const nonce = params.get('nonce') ?? '';
  const { state, loading, error } = useReportState(api, {
    projectId,
    reportId,
    revisionId,
    view: presenter ? 'detail' : 'presentation',
  });
  const source = presenter ? state.document : state.projection;
  const pages = useMemo(() => (source ? paginateReport(source) : []), [source]);
  const [page, setPage] = useState(0);
  const [black, setBlack] = useState(false);
  const [laser, setLaser] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number }>();
  const [seconds, setSeconds] = useState(0);
  const [popupError, setPopupError] = useState(false);
  const [audienceClosed, setAudienceClosed] = useState(false);
  const [controls, showControls] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const audience = useRef<Window | null>(null);
  const last = useRef({ page, black, laser, pointer });
  last.current = { page, black, laser, pointer };
  const initialFocus = useRef(document.activeElement);
  const expected = useMemo(
    () => ({ reportId, revisionId, nonce }),
    [reportId, revisionId, nonce]
  );
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(value => value + 1);
      if (audience.current?.closed) {
        setAudienceClosed(true);
        audience.current = null;
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const element = initialFocus.current;
    return () => {
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
      if (element instanceof HTMLElement && element.isConnected)
        element.focus();
      audience.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!controls) return;
    const timer = setTimeout(() => showControls(false), 5000);
    return () => clearTimeout(timer);
  }, [controls]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (presenter) {
        if (event.source !== audience.current) return;
        if (
          event.data?.kind === 'report-present-ready' &&
          event.data.reportId === reportId &&
          event.data.revisionId === revisionId &&
          event.data.nonce === nonce
        )
          audience.current?.postMessage(
            { kind: 'report-present', ...expected, ...last.current },
            window.location.origin
          );
      } else {
        if (event.source !== window.opener) return;
        const value = readPresentationMessage(
          event.data,
          expected,
          pages.length
        );
        if (value) {
          setPage(value.page);
          setBlack(value.black);
          setLaser(value.laser ?? false);
          setPointer(value.pointer);
        }
      }
    };
    window.addEventListener('message', listener);
    if (!presenter && window.opener && pages.length)
      window.opener.postMessage(
        { kind: 'report-present-ready', ...expected },
        window.location.origin
      );
    return () => window.removeEventListener('message', listener);
  }, [expected, pages.length, presenter, reportId, revisionId, nonce]);
  useEffect(() => {
    if (presenter)
      audience.current?.postMessage(
        { kind: 'report-present', ...expected, page, black, laser, pointer },
        window.location.origin
      );
  }, [black, expected, page, presenter, laser, pointer]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.matches('input,textarea,select') ||
          event.target.isContentEditable)
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        navigate(getProjectReportPath(projectId, reportId), {
          state: { reportReturnFocus: presenter ? 'presenter' : 'present' },
        });
        return;
      }
      if (event.key.toLowerCase() === 'b') {
        setBlack(value => !value);
        return;
      }
      const next = presentationKey(event.key, page, pages.length);
      if (next !== page) {
        event.preventDefault();
        setPage(next);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [navigate, page, pages.length, projectId, reportId, presenter]);
  const openAudience = () => {
    const url = getProjectReportPresentationPath(
      projectId,
      reportId,
      'present',
      {
        revisionId,
        nonce,
      }
    );
    audience.current = window.open(
      url,
      `report-${nonce}`,
      'popup,width=1280,height=800'
    );
    setPopupError(!audience.current);
    setAudienceClosed(false);
  };
  const point = (event: PointerEvent<HTMLElement>) => {
    if (!laser) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setPointer({
      x: Math.max(
        0,
        Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)
      ),
      y: Math.max(
        0,
        Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)
      ),
    });
  };
  const pointerView =
    !black && laser && pointer ? (
      <span
        aria-hidden="true"
        className={styles.pointer}
        style={{ left: `${pointer.x}%`, top: `${pointer.y}%` }}
      />
    ) : null;
  if (loading || (!source && !error && revisionId && nonce)) return <Loading />;
  if (error && isProjectAccessError(error) && !BUILD_CONFIG.isElectron)
    return <ReportAccessDenied />;
  if (!revisionId || !nonce || error || !source)
    return (
      <div className={styles.empty} role="alert">
        {t('presentationUnavailable')}
        <Button
          onClick={() =>
            navigate(getProjectReportPath(projectId, reportId), {
              state: { reportReturnFocus: presenter ? 'presenter' : 'present' },
            })
          }
        >
          {t('back')}
        </Button>
      </div>
    );
  const current = pages[Math.min(page, pages.length - 1)];
  const exit = () =>
    navigate(getProjectReportPath(projectId, reportId), {
      state: { reportReturnFocus: presenter ? 'presenter' : 'present' },
    });
  const footer = current ? (
    <>
      <span>{source.title}</span>
      <span>
        {page + 1} / {pages.length}
      </span>
    </>
  ) : null;
  return (
    <div
      className={styles.presentationRoot}
      ref={root}
      onMouseMove={() => showControls(true)}
      onFocusCapture={() => showControls(true)}
    >
      <header
        className={styles.presentationBar}
        data-dimmed={!controls && !presenter}
      >
        <button type="button" className={styles.darkButton} onClick={exit}>
          ← {t('exit')}
        </button>
        <h1>{source.title}</h1>
        <button
          type="button"
          className={styles.darkButton}
          onClick={() =>
            void root.current
              ?.requestFullscreen()
              .catch(() => setPopupError(true))
          }
        >
          {t('fullscreen')}
        </button>
        {presenter && (
          <button
            type="button"
            className={styles.darkButton}
            onClick={openAudience}
          >
            {t('openAudience')}
          </button>
        )}
        <button
          type="button"
          className={styles.darkButton}
          aria-pressed={black}
          onClick={() => setBlack(value => !value)}
        >
          {t('blackScreen')}
        </button>
        <button
          type="button"
          className={styles.darkButton}
          aria-pressed={laser}
          onClick={() => setLaser(value => !value)}
        >
          {t('pointer')}
        </button>
      </header>
      {audienceClosed && (
        <p role="status" className={styles.muted} style={{ padding: '0 16px' }}>
          {t('audienceClosed')}
        </p>
      )}
      {popupError && (
        <div
          role="status"
          className={styles.error}
          style={{ margin: '0 16px' }}
        >
          {t('windowBlocked')}
        </div>
      )}
      {current ? (
        presenter ? (
          <main className={styles.presenter}>
            <div
              className={styles.stage}
              onPointerMove={point}
              onPointerLeave={() => setPointer(undefined)}
              onPointerCancel={() => setPointer(undefined)}
            >
              {pointerView}
              {black && <div className={styles.black} />}
              <ReportSlide
                page={current}
                theme={source.theme}
                assetUrls={state.assetUrls}
                footer={footer}
              />
            </div>
            <aside className={styles.presenterAside}>
              <h2>{t('elapsed')}</h2>
              <span className={styles.timer}>
                {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, '0')}
                <span className={styles.muted}>
                  {' '}
                  / {source.durationMinutes} {t('minutes')}
                </span>
              </span>
              <h2>{t('speakerNotes')}</h2>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6 }}>
                {current.notes || t('noNotes')}
              </p>
              <h2>{t('nextPage')}</h2>
              {pages[page + 1] && (
                <ReportSlide
                  page={pages[page + 1]}
                  theme={source.theme}
                  assetUrls={state.assetUrls}
                />
              )}
            </aside>
          </main>
        ) : (
          <main
            className={styles.stage}
            onPointerMove={point}
            onPointerLeave={() => setPointer(undefined)}
            onPointerCancel={() => setPointer(undefined)}
          >
            {black && (
              <div className={styles.black} aria-label={t('blackScreen')} />
            )}
            <ReportSlide
              page={current}
              theme={source.theme}
              assetUrls={state.assetUrls}
              footer={footer}
            />
            {pointerView}
          </main>
        )
      ) : (
        <p className={styles.empty}>{t('emptyReport')}</p>
      )}
      <footer
        className={styles.presentationFooter}
        data-dimmed={!controls && !presenter}
      >
        <button
          type="button"
          className={styles.darkButton}
          disabled={page <= 0}
          onClick={() => setPage(value => Math.max(0, value - 1))}
        >
          ‹ {t('previousPage')}
        </button>
        <span aria-live="polite" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {Math.min(page + 1, pages.length)} / {pages.length}
        </span>
        <button
          type="button"
          className={styles.darkButton}
          disabled={page >= pages.length - 1}
          onClick={() =>
            setPage(value => Math.min(pages.length - 1, value + 1))
          }
        >
          {t('nextPage')} ›
        </button>
        <select
          className={styles.darkSelect}
          aria-label={t('jumpTo')}
          value={String(page)}
          onChange={event => setPage(Number(event.target.value))}
        >
          {pages.map((item, index) => (
            <option key={item.id} value={String(index)}>
              {index + 1} · {item.title}
            </option>
          ))}
        </select>
      </footer>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label={t('presentationProgress')}
        aria-valuemin={1}
        aria-valuemax={Math.max(1, pages.length)}
        aria-valuenow={page + 1}
        style={{
          width: `${pages.length ? ((page + 1) / pages.length) * 100 : 0}%`,
        }}
      />
    </div>
  );
}
