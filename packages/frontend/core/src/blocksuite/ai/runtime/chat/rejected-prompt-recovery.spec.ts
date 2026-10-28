import { expect, test, vi } from 'vitest';

import { createRejectedPromptRecovery } from './rejected-prompt-recovery';

function fixture() {
  const values = new Map<string, string>();
  let actor = 'a';
  const recovery = createRejectedPromptRecovery(
    () => actor,
    () => ({
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: key => {
        values.delete(key);
      },
    })
  );
  return {
    recovery,
    values,
    changeActor: (value: string) => {
      actor = value;
    },
  };
}

test('rejected drafts are isolated by actor, scope and session', () => {
  const { recovery, changeActor } = fixture();
  recovery.write('a', 'project:p1', 's1', 'private draft');
  expect(recovery.read('a', 'project:p1', 's1')).toBe('private draft');
  expect(recovery.read('a', 'project:p2', 's1')).toBeUndefined();
  expect(recovery.read('a', 'project:p1', 's2')).toBeUndefined();
  changeActor('b');
  expect(recovery.read('a', 'project:p1', 's1')).toBeUndefined();
  expect(recovery.read('b', 'project:p1', 's1')).toBeUndefined();
  recovery.write('a', 'project:p1', 's1', 'late completion from actor a');
  recovery.clear('a', 'project:p1', 's1');
  changeActor('a');
  expect(recovery.read('a', 'project:p1', 's1')).toBe('private draft');
  recovery.clear('a', 'project:p1', 's1');
  expect(recovery.read('a', 'project:p1', 's1')).toBeUndefined();
});

test('expired, corrupt and oversized drafts are not restored', () => {
  const { recovery, values } = fixture();
  vi.useFakeTimers();
  try {
    recovery.write('a', 'project:p1', 's1', 'expired');
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(recovery.read('a', 'project:p1', 's1')).toBeUndefined();
    expect(values.size).toBe(0);
    recovery.write('a', 'project:p1', 's1', 'x'.repeat(128_001));
    expect(values.size).toBe(0);
    recovery.write('a', 'project:p1', 's1', 'valid');
    values.set([...values.keys()][0], '{invalid');
    expect(recovery.read('a', 'project:p1', 's1')).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test('unavailable browser storage does not mask the original request error', () => {
  const recovery = createRejectedPromptRecovery(
    () => 'a',
    () => {
      throw new Error('Storage is disabled');
    }
  );
  expect(() => recovery.write('a', 'p', 's', 'text')).not.toThrow();
  expect(recovery.read('a', 'p', 's')).toBeUndefined();
  expect(() => recovery.clear('a', 'p', 's')).not.toThrow();
});
