import { expect, test, vi } from 'vitest';

import { changeResourceBatch } from './batch';

test('a mixed batch waits for each result, preserves failures and retries only failed identities', async () => {
  let finish!: () => void;
  const first = new Promise<void>(resolve => {
    finish = resolve;
  });
  const execute = vi.fn(async (id: string) => {
    if (id === 'doc') await first;
    if (id === 'pdf') throw new Error('version changed');
  });
  const run = changeResourceBatch(['doc', 'pdf', 'text', 'doc'], execute);
  expect(execute.mock.calls.map(([id]) => id)).toEqual(['doc']);
  finish();
  const result = await run;
  expect(result).toEqual({ succeeded: ['doc', 'text'], failed: ['pdf'] });
  const retry = vi.fn(async () => {});
  await changeResourceBatch(result.failed, retry);
  expect(retry.mock.calls).toEqual([['pdf']]);
});

test('oversized batches are rejected before the first side effect', async () => {
  const execute = vi.fn();
  await expect(
    changeResourceBatch(
      Array.from({ length: 101 }, (_, index) => String(index)),
      execute
    )
  ).rejects.toThrow('100');
  expect(execute).not.toHaveBeenCalled();
});
