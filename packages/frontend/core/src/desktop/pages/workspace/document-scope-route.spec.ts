import { describe, expect, test } from 'vitest';

import { resolveDocumentScopeAccess } from './document-scope-route';

describe('resolveDocumentScopeAccess', () => {
  test.each(['read', 'write'] as const)(
    'accepts a matching document scope with %s access',
    access => {
      const params = new URLSearchParams({ docScope: 'doc-1', access });
      expect(resolveDocumentScopeAccess(params, 'doc-1')).toBe(access);
    }
  );

  test.each([
    new URLSearchParams({ docScope: 'doc-other', access: 'read' }),
    new URLSearchParams({ docScope: 'doc-1', access: 'owner' }),
    new URLSearchParams({ access: 'read' }),
  ])('fails closed for a mismatched or invalid scope', params => {
    expect(resolveDocumentScopeAccess(params, 'doc-1')).toBeNull();
  });
});
