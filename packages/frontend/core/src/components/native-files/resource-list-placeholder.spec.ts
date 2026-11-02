import { describe, expect, test } from 'vitest';

import { resourceListPlaceholder } from './resource-list-placeholder';

const ready = {
  catalogLoading: false,
  catalogReady: true,
  catalogError: false,
  queryLoading: false,
  queryError: false,
  folderError: false,
  docsPending: false,
  checkingReadable: false,
  readableCheckFailed: false,
};

describe('resourceListPlaceholder', () => {
  test('shows loading, not empty, while candidates wait for their ACL check', () => {
    expect(resourceListPlaceholder({ ...ready, checkingReadable: true })).toBe(
      'loading'
    );
  });

  test('reports a failed ACL check as a retryable error instead of empty', () => {
    expect(
      resourceListPlaceholder({ ...ready, readableCheckFailed: true })
    ).toBe('error');
  });

  test('keeps the existing catalog and query states', () => {
    expect(resourceListPlaceholder({ ...ready, catalogLoading: true })).toBe(
      'loading'
    );
    expect(resourceListPlaceholder({ ...ready, catalogReady: false })).toBe(
      'loading'
    );
    expect(resourceListPlaceholder({ ...ready, docsPending: true })).toBe(
      'loading'
    );
    expect(resourceListPlaceholder({ ...ready, queryError: true })).toBe(
      'error'
    );
    expect(resourceListPlaceholder(ready)).toBe('empty');
  });
});
