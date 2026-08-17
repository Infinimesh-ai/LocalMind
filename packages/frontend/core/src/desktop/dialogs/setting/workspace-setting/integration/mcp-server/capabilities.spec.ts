import { describe, expect, test } from 'vitest';

import { updateMcpCapabilities } from './capabilities';

describe('MCP capability selection', () => {
  test('selects one public AI tool capability', () => {
    expect([
      ...updateMcpCapabilities(new Set(), 'delegate_to_localmind', true),
    ]).toEqual(['delegate_to_localmind']);
  });

  test('removes only the selected public AI tool capability', () => {
    expect([
      ...updateMcpCapabilities(
        new Set(['get_localmind_task', 'control_localmind_task']),
        'get_localmind_task',
        false
      ),
    ]).toEqual(['control_localmind_task']);
  });

  test('keeps unrelated tool capabilities unchanged', () => {
    expect(
      [
        ...updateMcpCapabilities(
          new Set(['delegate_to_localmind', 'get_localmind_task']),
          'control_localmind_task',
          true
        ),
      ].sort()
    ).toEqual([
      'control_localmind_task',
      'delegate_to_localmind',
      'get_localmind_task',
    ]);
  });
});
