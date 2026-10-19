import './config';

import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import {
  type DeckShareView,
  upgradeDeckHtml,
} from '@localmind/office/report-deck';
import { Injectable } from '@nestjs/common';
import type { ReportDeckShare } from '@prisma/client';
import { z } from 'zod';

import {
  AccessDenied,
  BadRequest,
  Config,
  CryptoHelper,
  URLHelper,
} from '../../base';
import { Models } from '../../models';

export const DECK_SHARE_SESSION_MS = 30 * 60 * 1000;

export type DeckShareFailure =
  | 'password_required'
  | 'invalid_password'
  | 'invalid_token'
  | 'expired'
  | 'revoked';

/** Carries the HTTP status and public code of a share access failure. */
export class DeckShareError extends Error {
  constructor(readonly code: DeckShareFailure) {
    super(code);
  }
  get status() {
    return this.code === 'expired' || this.code === 'revoked' ? 410 : 401;
  }
}

export const deckShareTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export const deckShareCookieName = (shareId: string) =>
  `lm_deck_${shareId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 64)}`;

export const deckSharePath = (shareId: string) =>
  `/api/deck-shares/${encodeURIComponent(shareId)}`;

type ShareState = Pick<
  ReportDeckShare,
  'id' | 'tokenHash' | 'expiresAt' | 'revokedAt'
> & {
  deck: { status: string; deletedAt: Date | null };
};

/**
 * Link-state rules shared by `open` and every cookie-authorized read. The
 * token is compared first so an unknown token never learns the link state.
 */
export function evaluateDeckShare(
  share: ShareState | null,
  input: { tokenHash?: string; now: number; anonymousAllowed: boolean }
): DeckShareFailure | null {
  if (!share) return 'invalid_token';
  if (input.tokenHash !== undefined && input.tokenHash !== share.tokenHash)
    return 'invalid_token';
  if (
    share.revokedAt ||
    share.deck.deletedAt ||
    share.deck.status !== 'ready' ||
    !input.anonymousAllowed
  )
    return 'revoked';
  if (share.expiresAt.getTime() <= input.now) return 'expired';
  return null;
}

/** Validity window of a new share, bounded by the instance policy. */
export function deckShareExpiry(
  expiresInDays: number,
  maxShareDays: number,
  now = Date.now()
) {
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1)
    throw new BadRequest('Invalid share expiration');
  if (expiresInDays > maxShareDays)
    throw new BadRequest('Share expiration exceeds the instance policy');
  return new Date(now + expiresInDays * 86400000);
}

const sessionSchema = z
  .object({
    shareId: z.string(),
    tokenHash: z.string(),
    expiresAt: z.number(),
  })
  .strict();

/** `Content-Disposition` for a downloaded deck with an RFC 5987 UTF-8 name. */
export function deckDownloadDisposition(title: string) {
  const base =
    title
      .replace(/[\r\n\t]/g, ' ')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\p{Cc}/gu, '_')
      .trim()
      .slice(0, 120) || 'report';
  const filename = `${base}.html`;
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/[%;]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    filename
  ).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

export function inflateDeckHtml(gzip: Uint8Array | null | undefined) {
  if (!gzip) return null;
  return upgradeDeckHtml(gunzipSync(Buffer.from(gzip)).toString('utf8'));
}

@Injectable()
export class ReportDeckShareService {
  constructor(
    private readonly models: Models,
    private readonly crypto: CryptoHelper,
    private readonly url: URLHelper,
    private readonly config: Config
  ) {}

  shareUrl(share: Pick<ReportDeckShare, 'id' | 'tokenCipher'>) {
    try {
      const token = this.crypto.decrypt(share.tokenCipher);
      const base = (this.url.baseUrl ?? '').replace(/\/$/, '');
      return `${base}/share/decks/${encodeURIComponent(share.id)}#token=${token}`;
    } catch {
      return null;
    }
  }

  view(share: ReportDeckShare): DeckShareView {
    const active = !share.revokedAt && share.expiresAt.getTime() > Date.now();
    return {
      id: share.id,
      url: active ? this.shareUrl(share) : null,
      hasPassword: !!share.passwordHash,
      allowDownload: share.allowDownload,
      expiresAt: share.expiresAt.toISOString(),
      revokedAt: share.revokedAt?.toISOString() ?? null,
      createdAt: share.createdAt.toISOString(),
    };
  }

  async create(input: {
    ownerUserId: string;
    deckId: string;
    expiresInDays: number;
    password?: string;
    allowDownload: boolean;
  }) {
    if (!this.config.reportDecks.allowAnonymousShare)
      throw new AccessDenied('Report deck link sharing is disabled');
    const deck = await this.models.reportDeck.get(
      input.ownerUserId,
      input.deckId
    );
    if (!deck) throw new AccessDenied('Report deck is unavailable');
    if (deck.status !== 'ready')
      throw new BadRequest('Only a generated report deck can be shared');
    const expiresAt = deckShareExpiry(
      input.expiresInDays,
      this.config.reportDecks.maxShareDays
    );
    const token = randomBytes(32).toString('base64url');
    const share = await this.models.reportDeck.createShare({
      deckId: deck.id,
      tokenHash: deckShareTokenHash(token),
      tokenCipher: this.crypto.encrypt(token),
      passwordHash: input.password
        ? await this.crypto.encryptPassword(input.password)
        : null,
      allowDownload: input.allowDownload,
      expiresAt,
    });
    return this.view(share);
  }

  async revoke(ownerUserId: string, shareId: string) {
    const share = await this.models.reportDeck.revokeShare(
      ownerUserId,
      shareId
    );
    if (!share) throw new AccessDenied('Report deck share is unavailable');
    return share;
  }

  /** Verify the link token (and password) and issue an encrypted session. */
  async open(input: { shareId: string; token: string; password?: string }) {
    z.string().min(1).max(2048).parse(input.token);
    if (input.password !== undefined) z.string().max(256).parse(input.password);
    const share = await this.models.reportDeck.findShare(input.shareId);
    const tokenHash = deckShareTokenHash(input.token);
    const failure = evaluateDeckShare(share, {
      tokenHash,
      now: Date.now(),
      anonymousAllowed: this.config.reportDecks.allowAnonymousShare,
    });
    if (failure || !share) throw new DeckShareError(failure ?? 'invalid_token');
    if (share.passwordHash) {
      if (!input.password) throw new DeckShareError('password_required');
      if (
        !(await this.crypto.verifyPassword(input.password, share.passwordHash))
      )
        throw new DeckShareError('invalid_password');
    }
    const expiresAt = Math.min(
      Date.now() + DECK_SHARE_SESSION_MS,
      share.expiresAt.getTime()
    );
    return {
      cookie: this.crypto.encrypt(
        JSON.stringify({ shareId: share.id, tokenHash, expiresAt })
      ),
      expiresAt,
      view: {
        title: share.deck.title,
        allowDownload: share.allowDownload,
        slideCount: share.deck.slideCount ?? 0,
      },
    };
  }

  /** Re-check the share on every read: revocation and expiry apply at once. */
  async authorized(input: { shareId: string; cookie?: string }) {
    let session: z.infer<typeof sessionSchema>;
    try {
      session = sessionSchema.parse(
        JSON.parse(
          this.crypto.decrypt(z.string().max(4096).parse(input.cookie))
        )
      );
    } catch {
      throw new DeckShareError('invalid_token');
    }
    if (session.shareId !== input.shareId || session.expiresAt <= Date.now())
      throw new DeckShareError('invalid_token');
    const share = await this.models.reportDeck.findShare(input.shareId);
    const failure = evaluateDeckShare(share, {
      tokenHash: session.tokenHash,
      now: Date.now(),
      anonymousAllowed: this.config.reportDecks.allowAnonymousShare,
    });
    if (failure || !share) throw new DeckShareError(failure ?? 'invalid_token');
    return share;
  }

  async html(input: { shareId: string; cookie?: string; download: boolean }) {
    const share = await this.authorized(input);
    if (input.download && !share.allowDownload)
      throw new AccessDenied('Download is unavailable');
    const deck = await this.models.reportDeck.sharedHtml(share.deckId);
    const html = inflateDeckHtml(deck?.htmlGzip);
    if (!deck || html === null) throw new DeckShareError('revoked');
    return { title: deck.title, html };
  }
}
