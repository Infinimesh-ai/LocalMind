/** @vitest-environment happy-dom */
import type * as Office from '@affine/core/modules/office';
import {
  executeOfficeCommand,
  fetchOfficeState,
  previewOfficeCommand,
} from '@affine/core/modules/office';
import { afterEach, expect, test, vi } from 'vitest';

import { executeAndReloadOfficeCommand } from './shared';

vi.mock('@affine/core/modules/office', async importOriginal => ({
  ...(await importOriginal<typeof Office>()),
  executeOfficeCommand: vi.fn(),
  fetchOfficeState: vi.fn(),
  previewOfficeCommand: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

test('continuous saves skip redundant previews and reload the exact applied revision on replay', async () => {
  vi.mocked(executeOfficeCommand).mockResolvedValue({
    executeOfficeCommand: {
      created: false,
      revision: { id: 'applied', sequence: 2, stateUrl: '/applied-state' },
      artifact: {
        currentRevision: { id: 'newer', sequence: 3, stateUrl: '/newer-state' },
      },
      summary: {},
    },
  } as never);
  vi.mocked(fetchOfficeState).mockResolvedValue({ body: [] } as never);
  const result = await executeAndReloadOfficeCommand({
    graphql: {} as never,
    owner: { kind: 'workspace', workspaceId: 'workspace' },
    kind: 'document',
    command: {
      version: 'localmind-office-command/v1',
      operation: 'office.document.edit',
      source: 'user',
      artifactId: 'artifact',
      expectedRevisionId: 'revision-1',
      commandId: 'replay',
      idempotencyKey: 'replay',
      identities: [],
      patches: [],
    },
  });
  expect(previewOfficeCommand).not.toHaveBeenCalled();
  expect(executeOfficeCommand).toHaveBeenCalledTimes(1);
  expect(fetchOfficeState).toHaveBeenCalledWith('/applied-state', 'document');
  expect(result.revision.id).toBe('applied');
});
