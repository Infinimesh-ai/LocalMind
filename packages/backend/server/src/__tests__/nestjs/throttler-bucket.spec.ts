import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';
import test from 'ava';

import {
  CloudThrottlerGuard,
  Throttle,
  ThrottlerStorage,
} from '../../base/throttler';

class Routes {
  read() {}
  directory() {}
  write() {}
}
Throttle()(Routes);
for (const name of ['read', 'directory'] as const)
  Throttle('default', { bucket: 'workspace-tree-read' })(
    Routes.prototype,
    name,
    Object.getOwnPropertyDescriptor(Routes.prototype, name)!
  );

async function fixture(limit = 120) {
  const storage = new ThrottlerStorage();
  const guard = new CloudThrottlerGuard(
    { throttlers: [{ name: 'default', limit, ttl: 60_000 }] },
    storage,
    new Reflector(),
    { throttle: { enabled: true } } as never
  );
  await guard.onModuleInit();
  const run = (handler: keyof Routes, sessionId = 'first') => {
    const req = { session: { sessionId, user: { id: 'actor' } } };
    const res = { header() {} };
    return guard.canActivate({
      getClass: () => Routes,
      getHandler: () => Routes.prototype[handler],
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext);
  };
  return { storage, run };
}

for (const limit of [120, 240]) {
  test(`explicit read bucket stays separate when default limit is ${limit}`, async t => {
    const { storage, run } = await fixture(limit);
    try {
      for (let i = 0; i < limit; i++) await run('read');
      await t.throwsAsync(() => run('directory'), {
        instanceOf: ThrottlerException,
      });
      t.true(await run('write'));
      t.true(await run('read', 'second'));
      t.is(storage.storage.size, 3);
    } finally {
      storage.onApplicationShutdown();
    }
  });
}

test('exhausting writes does not consume the tree read bucket', async t => {
  const { storage, run } = await fixture();
  try {
    for (let i = 0; i < 120; i++) await run('write');
    await t.throwsAsync(() => run('write'), { instanceOf: ThrottlerException });
    t.true(await run('read'));
  } finally {
    storage.onApplicationShutdown();
  }
});
