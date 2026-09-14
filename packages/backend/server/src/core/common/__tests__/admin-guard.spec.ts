import test from 'ava';

import { AdminGuard } from '../admin-guard';

function contextFor(session: unknown) {
  const req = { session };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as any;
}

test('admin guard rejects non administrators', async t => {
  const guard = new AdminGuard({ get: () => undefined } as any);
  (guard as any).feature = { isAdmin: async () => false };
  await t.throwsAsync(guard.canActivate(contextFor({ user: { id: 'u1' } })), {
    instanceOf: Error,
  });
});

test('admin guard allows administrators', async t => {
  const guard = new AdminGuard({ get: () => undefined } as any);
  (guard as any).feature = { isAdmin: async () => true };
  t.true(await guard.canActivate(contextFor({ user: { id: 'u1' } })));
});
