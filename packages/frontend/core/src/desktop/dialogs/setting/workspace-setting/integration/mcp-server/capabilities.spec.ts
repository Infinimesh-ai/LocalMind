import { describe, expect, test } from 'vitest';

import { updateMcpCapabilities } from './capabilities';

describe('MCP capability selection', () => {
  test('selecting write also grants the matching read capability', () => {
    expect(
      [...updateMcpCapabilities(new Set(), 'ai-chat:write', true)].sort()
    ).toEqual(['ai-chat:read', 'ai-chat:write']);
  });

  test('removing read also removes the dependent write capability', () => {
    expect([
      ...updateMcpCapabilities(
        new Set(['ai-context:read', 'ai-context:write']),
        'ai-context:read',
        false
      ),
    ]).toEqual([]);
  });

  test('keeps unrelated capability groups unchanged', () => {
    expect(
      [
        ...updateMcpCapabilities(
          new Set(['documents:read', 'ai-operations:read']),
          'documents:write',
          true
        ),
      ].sort()
    ).toEqual(['ai-operations:read', 'documents:read', 'documents:write']);
  });

  test('applies read and write dependency to workspace feature scopes', () => {
    expect(
      [...updateMcpCapabilities(new Set(), 'collaboration:write', true)].sort()
    ).toEqual(['collaboration:read', 'collaboration:write']);
    expect([
      ...updateMcpCapabilities(
        new Set(['assets:read', 'assets:write']),
        'assets:read',
        false
      ),
    ]).toEqual([]);
  });
});
