import { describe, expect, test } from 'vitest';

import {
  DEFAULT_MCP_CAPABILITIES,
  updateMcpCapabilities,
} from './capabilities';

describe('MCP capability selection', () => {
  test('defaults to the complete public LocalMind workflow', () => {
    expect(DEFAULT_MCP_CAPABILITIES).toEqual([
      'delegate_to_localmind',
      'get_localmind_task',
      'control_localmind_task',
    ]);
  });

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

test('direct writes suggest receipt lookup without implicitly granting it or delegation', async () => {
  const {
    needsOperationQueryHint,
    MCP_CAPABILITY_GROUPS,
    MCP_WRITE_CAPABILITIES,
  } = await import('./capabilities');
  const capabilities = updateMcpCapabilities(
    new Set(),
    'workspace_doc_create',
    true
  );
  expect([...capabilities]).toEqual(['workspace_doc_create']);
  expect(needsOperationQueryHint(capabilities)).toBe(true);
  expect(
    needsOperationQueryHint(
      updateMcpCapabilities(capabilities, 'workspace_operation_get', true)
    )
  ).toBe(false);
  expect(needsOperationQueryHint(new Set(['workspace_doc_read']))).toBe(false);
  expect(MCP_WRITE_CAPABILITIES.has('workspace_doc_read')).toBe(false);
  expect(MCP_WRITE_CAPABILITIES.has('workspace_folder_move_document')).toBe(
    true
  );
  expect(MCP_CAPABILITY_GROUPS.map(group => group.options.length)).toEqual([
    10, 3,
  ]);
});
