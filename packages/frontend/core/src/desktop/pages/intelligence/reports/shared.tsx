import { Button, Loading } from '@affine/component';
import type { FetchService } from '@affine/core/modules/cloud';
import { readSharedReport } from '@affine/core/modules/project-reports/api';
import { paginateReport } from '@affine/core/modules/project-reports/presentation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { TextField, useReportText } from './fields';
import { ReportSlide } from './render';
import * as styles from './reports.css';

export function SharedReport({
  fetcher,
  baseUrl,
}: {
  fetcher: Pick<FetchService, 'fetch'>;
  baseUrl: string;
}) {
  const { shareId = '' } = useParams();
  const t = useReportText();
  const [data, setData] = useState<ReturnType<typeof readSharedReport>>();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const token = useRef(
    new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
  );
  const requests = useRef(0);
  const loadRef = useRef<(authenticate: boolean) => Promise<void>>(
    async () => {}
  );
  const path = `/api/report-shares/${encodeURIComponent(shareId)}`;
  const load = async (authenticate: boolean) => {
    const request = ++requests.current;
    setLoading(true);
    setError(false);
    try {
      if (authenticate)
        await fetcher.fetch(path, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: token.current,
            password: password || undefined,
          }),
        });
      const response = await fetcher.fetch(path, {
        credentials: 'include',
        cache: 'no-store',
      });
      const value = readSharedReport(await response.json(), baseUrl);
      if (request !== requests.current) return;
      setData(value);
      setPassword('');
      token.current = '';
      history.replaceState(
        history.state,
        '',
        location.pathname + location.search
      );
    } catch {
      if (request !== requests.current) return;
      setData(undefined);
      setError(true);
    } finally {
      if (request === requests.current) setLoading(false);
    }
  };
  loadRef.current = load;
  useEffect(() => {
    token.current =
      new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    setPage(0);
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex,nofollow,noarchive';
    document.head.append(robots);
    loadRef.current(!!token.current).catch(() => {});
    const timer = setInterval(() => {
      if (!document.hidden) loadRef.current(false).catch(() => {});
    }, 15000);
    return () => {
      requests.current += 1;
      robots.remove();
      clearInterval(timer);
      setData(undefined);
    };
    // The authorization is bound to this route, never to changing form fields.
  }, [shareId]);
  const pages = useMemo(
    () => (data ? paginateReport(data.projection) : []),
    [data]
  );
  if (!data)
    return (
      <div className={styles.root}>
        <main className={styles.empty}>
          <h1>{t('sharedReport')}</h1>
          {loading ? (
            <Loading />
          ) : (
            <>
              <p role="status">
                {t(error ? 'shareUnavailable' : 'shareAuthentication')}
              </p>
              <TextField
                label={t('password')}
                type="password"
                value={password}
                onChange={setPassword}
              />
              <Button onClick={() => void load(true).catch(() => {})}>
                {t('open')}
              </Button>
            </>
          )}
        </main>
      </div>
    );
  return (
    <div className={styles.root}>
      <header className={styles.toolbar}>
        <h1 className={styles.title}>{data.projection.title}</h1>
        <Button
          onClick={() =>
            void document.documentElement.requestFullscreen().catch(() => {})
          }
        >
          {t('fullscreen')}
        </Button>
        {Object.entries(data.downloads).map(([format, url]) => (
          <a key={format} className={styles.link} href={url} download>
            {t('download')}{' '}
            {format === 'offline' ? t('offline') : format.toUpperCase()}
          </a>
        ))}
      </header>
      <main className={styles.stage}>
        {pages[page] && (
          <ReportSlide
            page={pages[page]}
            theme={data.projection.theme}
            assetUrls={data.assetUrls}
          />
        )}
      </main>
      <footer className={styles.toolbar}>
        <Button
          disabled={page === 0}
          onClick={() => setPage(value => value - 1)}
        >
          {t('previousPage')}
        </Button>
        <span>
          {page + 1} / {pages.length}
        </span>
        <Button
          disabled={page >= pages.length - 1}
          onClick={() => setPage(value => value + 1)}
        >
          {t('nextPage')}
        </Button>
      </footer>
    </div>
  );
}
