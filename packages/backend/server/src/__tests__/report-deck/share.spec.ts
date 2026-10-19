import { gzipSync } from 'node:zlib';

import test from 'ava';

import {
  deckDownloadDisposition,
  deckShareCookieName,
  DeckShareError,
  deckShareExpiry,
  deckShareTokenHash,
  evaluateDeckShare,
  ReportDeckShareService,
} from '../../core/report-deck/share';

const now = Date.now();
const share = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  deckId: 'd1',
  tokenHash: deckShareTokenHash('token'),
  tokenCipher: 'enc:token',
  passwordHash: null as string | null,
  allowDownload: false,
  expiresAt: new Date(now + 86400000),
  revokedAt: null as Date | null,
  createdAt: new Date(now),
  deck: {
    id: 'd1',
    title: '季度汇报',
    status: 'ready',
    slideCount: 8,
    deletedAt: null as Date | null,
  },
  ...overrides,
});

test('link state: unknown token hides the state; revoked, deleted and expired links', t => {
  const options = { now, anonymousAllowed: true };
  t.is(
    evaluateDeckShare(share(), {
      ...options,
      tokenHash: deckShareTokenHash('token'),
    }),
    null
  );
  t.is(evaluateDeckShare(null, options), 'invalid_token');
  t.is(
    evaluateDeckShare(share({ revokedAt: new Date(now) }), {
      ...options,
      tokenHash: 'wrong',
    }),
    'invalid_token'
  );
  t.is(
    evaluateDeckShare(share({ revokedAt: new Date(now) }), options),
    'revoked'
  );
  t.is(
    evaluateDeckShare(
      share({ deck: { ...share().deck, deletedAt: new Date(now) } }),
      options
    ),
    'revoked'
  );
  t.is(
    evaluateDeckShare(share({ expiresAt: new Date(now) }), options),
    'expired'
  );
  t.is(evaluateDeckShare(share(), { now, anonymousAllowed: false }), 'revoked');
});

test('share expiry respects the instance maximum', t => {
  t.is(deckShareExpiry(7, 30, now).getTime(), now + 7 * 86400000);
  t.throws(() => deckShareExpiry(30, 7, now));
  t.throws(() => deckShareExpiry(0, 7, now));
});

test('download names are RFC 5987 encoded and header-safe', t => {
  const header = deckDownloadDisposition('季度/汇报"\r\n');
  t.true(header.startsWith('attachment; filename="'));
  t.false(/[\r\n]/.test(header));
  t.true(
    header.includes(`filename*=UTF-8''${encodeURIComponent('季度_汇报_.html')}`)
  );
  t.is(
    deckDownloadDisposition(''),
    `attachment; filename="report.html"; filename*=UTF-8''report.html`
  );
  t.is(deckShareCookieName('a-b_c'), 'lm_deck_abc');
});

function fixture(row: ReturnType<typeof share> | null, anonymous = true) {
  const crypto = {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => {
      if (!value.startsWith('enc:')) throw new Error('bad cipher');
      return value.slice(4);
    },
    encryptPassword: async (value: string) => `hash:${value}`,
    verifyPassword: async (value: string, hash: string) =>
      hash === `hash:${value}`,
  };
  const models = {
    reportDeck: {
      findShare: async () => row,
      sharedHtml: async () => ({
        id: 'd1',
        title: '季度汇报',
        htmlGzip: gzipSync(Buffer.from('<html>deck</html>')),
      }),
    },
  };
  const config = {
    reportDecks: { allowAnonymousShare: anonymous, maxShareDays: 30 },
  };
  return new ReportDeckShareService(
    models as any,
    crypto as any,
    { baseUrl: 'https://lm.example/' } as any,
    config as any
  );
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    t_assert(error instanceof DeckShareError);
    return { code: error.code, status: error.status };
  }
  return null;
};
function t_assert(value: boolean): asserts value {
  if (!value) throw new Error('expected DeckShareError');
}

test('open verifies token and password and issues a scoped session', async t => {
  const protectedShare = share({ passwordHash: 'hash:secret' });
  const service = fixture(protectedShare);
  t.deepEqual(await code(service.open({ shareId: 's1', token: 'nope' })), {
    code: 'invalid_token',
    status: 401,
  });
  t.deepEqual(await code(service.open({ shareId: 's1', token: 'token' })), {
    code: 'password_required',
    status: 401,
  });
  t.deepEqual(
    await code(
      service.open({ shareId: 's1', token: 'token', password: 'wrong' })
    ),
    { code: 'invalid_password', status: 401 }
  );
  const session = await service.open({
    shareId: 's1',
    token: 'token',
    password: 'secret',
  });
  t.deepEqual(session.view, {
    title: '季度汇报',
    allowDownload: false,
    slideCount: 8,
  });
  t.true(session.expiresAt <= Date.now() + 30 * 60 * 1000);
  const read = await service.html({
    shareId: 's1',
    cookie: session.cookie,
    download: false,
  });
  t.is(read.html, '<html>deck</html>');
  // Sessions are bound to their share and downloads need permission.
  t.deepEqual(
    await code(service.authorized({ shareId: 's2', cookie: session.cookie })),
    { code: 'invalid_token', status: 401 }
  );
  await t.throwsAsync(() =>
    service.html({ shareId: 's1', cookie: session.cookie, download: true })
  );
  t.deepEqual(
    await code(service.authorized({ shareId: 's1', cookie: 'forged' })),
    { code: 'invalid_token', status: 401 }
  );
});

test('revocation and expiry apply to existing sessions', async t => {
  const row = share();
  const service = fixture(row);
  const session = await service.open({ shareId: 's1', token: 'token' });
  row.revokedAt = new Date();
  t.deepEqual(
    await code(service.authorized({ shareId: 's1', cookie: session.cookie })),
    { code: 'revoked', status: 410 }
  );
  const expired = fixture(share({ expiresAt: new Date(Date.now() - 1000) }));
  t.deepEqual(await code(expired.open({ shareId: 's1', token: 'token' })), {
    code: 'expired',
    status: 410,
  });
  const disabled = fixture(share(), false);
  t.deepEqual(await code(disabled.open({ shareId: 's1', token: 'token' })), {
    code: 'revoked',
    status: 410,
  });
});

test('share views expose the URL only while active', t => {
  const service = fixture(null);
  t.is(
    service.view(share() as any).url,
    'https://lm.example/share/decks/s1#token=token'
  );
  t.is(service.view(share({ revokedAt: new Date() }) as any).url, null);
  t.like(service.view(share({ passwordHash: 'h' }) as any), {
    hasPassword: true,
    allowDownload: false,
  });
});
