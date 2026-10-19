import { Modal, notify } from '@affine/component';
import { absoluteShareUrl } from '@affine/core/modules/report-decks/api';
import { useDeckCommand } from '@affine/core/modules/report-decks/hooks';
import {
  useDeckLanguage,
  useDeckText,
} from '@affine/core/modules/report-decks/i18n';
import type {
  DeckDetail,
  DeckShareView,
} from '@affine/core/modules/report-decks/types';
import {
  CopyIcon,
  LinkIcon,
  LockIcon,
  WarningIcon,
} from '@blocksuite/icons/rc';
import { useEffect, useState } from 'react';

import { formatDeckTime, sourceScopeLabels } from './deck-ui';
import * as styles from './report-decks.css';

const EXPIRY = [1, 7, 30] as const;

function shareState(share: DeckShareView, now: number) {
  if (share.revokedAt) return 'revoked';
  const expires = new Date(share.expiresAt).getTime();
  if (Number.isFinite(expires) && expires <= now) return 'expired';
  return 'active';
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareDialog({
  deck,
  open,
  onClose,
}: {
  deck: DeckDetail;
  open: boolean;
  onClose: () => void;
}) {
  const t = useDeckText();
  const language = useDeckLanguage();
  const command = useDeckCommand();
  const [expiresInDays, setExpiresInDays] =
    useState<(typeof EXPIRY)[number]>(7);
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [created, setCreated] = useState<DeckShareView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCreated(null);
    setFailed(false);
    setPassword('');
    setUsePassword(false);
  }, [open]);
  const scopes = sourceScopeLabels(
    deck.sources.filter(source => source.status !== 'excluded'),
    t
  );
  const passwordInvalid = usePassword && password.length < 4;
  const now = Date.now();
  const create = async () => {
    setFailed(false);
    try {
      const result = await command.run({
        operation: 'share.create',
        deckId: deck.id,
        expiresInDays,
        allowDownload,
        ...(usePassword && password ? { password } : {}),
      });
      if (!result.share) throw new Error('Missing share');
      setCreated(result.share);
      setPassword('');
      if (result.share.url && (await copy(absoluteShareUrl(result.share.url))))
        notify.success({ title: t('share.copied') });
    } catch {
      setFailed(true);
    }
  };
  const revoke = async (share: DeckShareView) => {
    try {
      await command.run({ operation: 'share.revoke', shareId: share.id });
      if (created?.id === share.id) setCreated(null);
    } catch {
      notify.error({ title: t('error.commandFailed') });
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={value => !value && onClose()}
      title={t('share.title')}
      width="min(560px, 94vw)"
    >
      <div className={styles.stack}>
        <p
          className={styles.notice}
          data-tone="warning"
          data-testid="share-scope-warning"
        >
          <WarningIcon />
          <span>
            {scopes.length
              ? t('share.scopeWarning', {
                  scopes: scopes.join(t('listSeparator')),
                })
              : t('share.scopeWarningGeneric')}
          </span>
        </p>
        {created?.url ? (
          <div className={styles.linkBox}>
            <input
              className={styles.input}
              readOnly
              aria-label={t('share.link')}
              value={absoluteShareUrl(created.url)}
              onFocus={event => event.currentTarget.select()}
            />
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() =>
                void copy(absoluteShareUrl(created.url ?? '')).then(ok =>
                  ok
                    ? notify.success({ title: t('share.copied') })
                    : notify.error({ title: t('share.copyFailed') })
                )
              }
            >
              <CopyIcon />
              {t('share.copy')}
            </button>
          </div>
        ) : null}
        <div className={styles.field}>
          {t('share.expiry')}
          <div
            className={styles.segmented}
            role="group"
            aria-label={t('share.expiry')}
          >
            {EXPIRY.map(days => (
              <button
                key={days}
                type="button"
                className={styles.segment}
                style={{ minWidth: 88 }}
                aria-pressed={expiresInDays === days}
                onClick={() => setExpiresInDays(days)}
              >
                <strong>{t('share.days', { count: days })}</strong>
              </button>
            ))}
          </div>
        </div>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={usePassword}
            onChange={event => setUsePassword(event.target.checked)}
          />
          <span>
            <strong>{t('share.password')}</strong>
            <span>{t('share.passwordHint')}</span>
          </span>
        </label>
        {usePassword && (
          <label className={styles.field}>
            {t('share.passwordLabel')}
            <input
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={128}
              onChange={event => setPassword(event.target.value)}
            />
          </label>
        )}
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={allowDownload}
            onChange={event => setAllowDownload(event.target.checked)}
          />
          <span>
            <strong>{t('share.allowDownload')}</strong>
            <span>{t('share.allowDownloadHint')}</span>
          </span>
        </label>
        {failed && (
          <p className={styles.error} role="alert">
            {t('share.createFailed')}
          </p>
        )}
        <div className={styles.row}>
          <span className={styles.spacer} />
          <button type="button" className={styles.button} onClick={onClose}>
            {t('action.close')}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={command.pending || passwordInvalid}
            onClick={() => void create()}
          >
            <LinkIcon />
            {t('share.create')}
          </button>
        </div>
        {deck.shares.length > 0 && (
          <div className={styles.stack}>
            <h3 className={styles.panelHeading}>{t('share.existing')}</h3>
            <ul className={styles.shareList}>
              {deck.shares.map(share => {
                const state = shareState(share, now);
                return (
                  <li
                    key={share.id}
                    className={styles.shareRow}
                    data-inactive={state !== 'active' || undefined}
                    data-testid="deck-share"
                  >
                    <span
                      className={styles.pill}
                      data-tone={state === 'active' ? 'success' : undefined}
                    >
                      {t(`share.state.${state}`)}
                    </span>
                    <span>
                      {t('share.expiresAt', {
                        time: formatDeckTime(share.expiresAt, language),
                      })}
                    </span>
                    {share.hasPassword && (
                      <span className={styles.pill}>
                        <LockIcon width={12} height={12} />
                        {t('share.hasPassword')}
                      </span>
                    )}
                    {share.allowDownload && (
                      <span className={styles.pill}>
                        {t('share.downloadable')}
                      </span>
                    )}
                    <span className={styles.spacer} />
                    {state === 'active' && share.url && (
                      <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() =>
                          void copy(absoluteShareUrl(share.url ?? '')).then(
                            ok =>
                              ok
                                ? notify.success({ title: t('share.copied') })
                                : notify.error({ title: t('share.copyFailed') })
                          )
                        }
                      >
                        <CopyIcon />
                        {t('share.copy')}
                      </button>
                    )}
                    {state === 'active' && (
                      <button
                        type="button"
                        className={styles.dangerButton}
                        disabled={command.pending}
                        onClick={() => void revoke(share)}
                      >
                        {t('share.revoke')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
