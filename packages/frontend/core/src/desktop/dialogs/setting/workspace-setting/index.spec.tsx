/**
 * @vitest-environment happy-dom
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('./ai-context', () => ({ AIContextSettings: () => null }));
vi.mock('./billing', () => ({ WorkspaceSettingBilling: () => null }));
vi.mock('./byok', () => ({
  WorkspaceByokSetting: () => (
    <div data-testid="workspace-byok-settings">BYOK</div>
  ),
}));
vi.mock('./integration', () => ({ IntegrationSetting: () => null }));
vi.mock('./license', () => ({ WorkspaceSettingLicense: () => null }));
vi.mock('./members', () => ({ MembersPanel: () => null }));
vi.mock('./preference', () => ({ WorkspaceSettingDetail: () => null }));
vi.mock('./properties', () => ({ WorkspaceSettingProperties: () => null }));
vi.mock('./storage', () => ({ WorkspaceSettingStorage: () => null }));
vi.mock('@affine/core/modules/workspace-indexer-embedding', () => ({
  EmbeddingSettings: () => null,
}));

import { WorkspaceSetting } from '.';

describe('WorkspaceSetting', () => {
  test('renders the direct BYOK settings entry', () => {
    render(
      <WorkspaceSetting
        activeTab="workspace:byok"
        onChangeSettingState={vi.fn()}
        onCloseSetting={vi.fn()}
      />
    );

    expect(screen.getByTestId('workspace-byok-settings')).not.toBeNull();
  });
});
