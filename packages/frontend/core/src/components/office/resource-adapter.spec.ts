import type * as OfficeModule from '@affine/core/modules/office';
/** @vitest-environment happy-dom */
import { downloadOfficePackage } from '@affine/core/modules/office';
import { expect, test, vi } from 'vitest';

import { createOfficeResourceAdapter } from './resource-adapter';
vi.mock('@affine/core/modules/office', async original => ({
  ...(await original<typeof OfficeModule>()),
  downloadOfficePackage: vi.fn(),
}));
test.each(['workspace', 'project'] as const)(
  'compatibility download preserves %s and revision identity while raw download remains unchanged',
  async kind => {
    const owner =
      kind === 'workspace'
        ? { kind, workspaceId: 'owner' }
        : { kind, projectId: 'owner' };
    const adapter = createOfficeResourceAdapter({} as never, owner, 'a');
    const artifact = {
      id: 'a',
      kind: 'workbook',
      title: 'Budget.xlsx',
    } as never;
    const revision = {
      artifactId: 'a',
      workspaceId: kind === 'workspace' ? 'owner' : null,
      projectId: kind === 'project' ? 'owner' : null,
      sequence: 1,
      packageUrl: `/api/${kind}s/owner/office/artifacts/a/revisions/old/package`,
    } as never;
    await adapter.exportWorkbookCopy!(artifact, revision);
    expect(downloadOfficePackage).toHaveBeenLastCalledWith(
      expect.stringContaining('/revisions/old/export/xlsx'),
      'Budget-v1-compatible.xlsx'
    );
    await adapter.download(artifact, revision);
    expect(downloadOfficePackage).toHaveBeenLastCalledWith(
      expect.stringContaining('/revisions/old/package'),
      'Budget.xlsx'
    );
    expect(() =>
      adapter.exportWorkbookCopy!(artifact, {
        ...(revision as object),
        artifactId: 'other',
      } as never)
    ).toThrow();
  }
);
