import { Loading } from '@affine/component';
import {
  DefaultServerService,
  ServerService,
} from '@affine/core/modules/cloud';
import {
  fetchSharedDeckHtml,
  openDeckShare,
  sharedDeckHtmlUrl,
} from '@affine/core/modules/report-decks/api';
import { useDeckText } from '@affine/core/modules/report-decks/i18n';
import type { DeckShareOpenResult } from '@affine/core/modules/report-decks/types';
import { DownloadIcon, LinkIcon, LockIcon } from '@blocksuite/icons/rc';
import { FrameworkScope, useService } from '@toeverything/infra';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { DeckFrame } from './deck-viewer';
import * as styles from './report-decks.css';

type View =
  | { state: 'loading' }
  | { state: 'password'; invalid: boolean }
  | {
      state: 'unavailable';
      reason: 'invalid_token' | 'expired' | 'revoked' | 'error';
    }
  | { state: 'ready'; title: string; allowDownload: boolean; html: string };

function readToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
}

export function SharedDeck({ baseUrl }: { baseUrl: string }) {
  const { shareId = '' } = useParams();
  const t = useDeckText();
  const [view, setView] = useState<View>({ state: 'loading' });
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const request = useRef(0);

  const open = async (input: { password?: string }) => {
    const id = ++request.current;
    const result: DeckShareOpenResult = await openDeckShare(baseUrl, shareId, {
      token: readToken(),
      password: input.password,
    });
    if (id !== request.current) return;
    if (result.status === 'ok') {
      try {
        const html = await fetchSharedDeckHtml(baseUrl, shareId);
        if (id !== request.current) return;
        setPassword('');
        setView({
          state: 'ready',
          title: result.title,
          allowDownload: result.allowDownload,
          html,
        });
        if (result.title) document.title = result.title;
      } catch {
        if (id === request.current)
          setView({ state: 'unavailable', reason: 'error' });
      }
      return;
    }
    if (
      result.status === 'password_required' ||
      result.status === 'invalid_password'
    )
      setView({
        state: 'password',
        invalid: result.status === 'invalid_password',
      });
    else setView({ state: 'unavailable', reason: result.status });
  };
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex,nofollow,noarchive';
    document.head.append(robots);
    setView({ state: 'loading' });
    if (!readToken())
      setView({ state: 'unavailable', reason: 'invalid_token' });
    else
      openRef
        .current({})
        .catch(() => setView({ state: 'unavailable', reason: 'error' }));
    return () => {
      request.current += 1;
      robots.remove();
    };
  }, [shareId]);

  if (view.state === 'ready')
    return (
      <div className={styles.sharedRoot}>
        <header className={styles.sharedBar}>
          <strong>{view.title || t('shared.title')}</strong>
          {view.allowDownload && (
            <a
              className={styles.sharedLink}
              href={sharedDeckHtmlUrl(baseUrl, shareId, true)}
              download
            >
              <DownloadIcon width={14} height={14} />
              {t('action.download')}
            </a>
          )}
        </header>
        <div className={styles.sharedFrame}>
          <DeckFrame html={view.html} title={view.title || t('shared.title')} />
        </div>
      </div>
    );

  return (
    <div className={styles.sharedRoot}>
      {view.state === 'loading' ? (
        <div className={styles.gate} role="status">
          <Loading />
          <p>{t('shared.opening')}</p>
        </div>
      ) : view.state === 'password' ? (
        <form
          className={styles.gate}
          onSubmit={event => {
            event.preventDefault();
            if (!password || submitting) return;
            setSubmitting(true);
            open({ password })
              .catch(() => setView({ state: 'unavailable', reason: 'error' }))
              .finally(() => setSubmitting(false));
          }}
        >
          <span className={styles.gateGlyph} aria-hidden="true">
            <LockIcon />
          </span>
          <h1>{t('shared.passwordTitle')}</h1>
          <p>{t('shared.passwordDescription')}</p>
          <input
            className={styles.input}
            type="password"
            autoFocus
            autoComplete="current-password"
            aria-label={t('share.passwordLabel')}
            aria-invalid={view.invalid || undefined}
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
          {view.invalid && (
            <p className={styles.error} role="alert">
              {t('shared.invalidPassword')}
            </p>
          )}
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!password || submitting}
          >
            {t('shared.open')}
          </button>
        </form>
      ) : (
        <div className={styles.gate} role="alert" data-reason={view.reason}>
          <span className={styles.gateGlyph} aria-hidden="true">
            <LinkIcon />
          </span>
          <h1>{t(`shared.${view.reason}.title`)}</h1>
          <p>{t(`shared.${view.reason}.description`)}</p>
        </div>
      )}
    </div>
  );
}

function ScopedSharedDeck() {
  const baseUrl = useService(ServerService).server.serverMetadata.baseUrl;
  return <SharedDeck baseUrl={baseUrl} />;
}

/** Public: no sign-in, the link token (and optional password) authorize. */
export function Component() {
  const server = useService(DefaultServerService).server;
  return (
    <FrameworkScope scope={server?.scope}>
      <ScopedSharedDeck />
    </FrameworkScope>
  );
}
