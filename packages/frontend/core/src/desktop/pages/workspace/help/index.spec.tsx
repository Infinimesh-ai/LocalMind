/**
 * @vitest-environment happy-dom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { filterGuideSections, HelpCenterPage } from './index';

const openWorkbench = vi.hoisted(() => vi.fn());
const openDialog = vi.hoisted(() => vi.fn());
const WorkspaceDialogServiceToken = vi.hoisted(
  () => class WorkspaceDialogService {}
);
const WorkbenchServiceToken = vi.hoisted(() => class WorkbenchService {});

vi.mock('@affine/core/components/pure/header', () => ({
  Header: ({ left, right }: { left?: ReactNode; right?: ReactNode }) => (
    <header>
      {left}
      {right}
    </header>
  ),
}));

vi.mock('@affine/core/modules/dialogs', () => ({
  WorkspaceDialogService: WorkspaceDialogServiceToken,
}));

vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: WorkbenchServiceToken,
  ViewBody: ({ children }: PropsWithChildren) => (
    <div data-testid="view-body">{children}</div>
  ),
  ViewHeader: ({ children }: PropsWithChildren) => (
    <div data-testid="view-header">{children}</div>
  ),
  ViewIcon: () => null,
  ViewTitle: () => null,
}));

vi.mock('@toeverything/infra', () => ({
  useService: (token: unknown) => {
    if (token === WorkbenchServiceToken) {
      return { workbench: { open: openWorkbench } };
    }
    if (token === WorkspaceDialogServiceToken) {
      return { open: openDialog };
    }
    return {};
  },
}));

describe('LocalMind help center', () => {
  afterEach(cleanup);

  beforeEach(() => {
    openWorkbench.mockReset();
    openDialog.mockReset();
  });

  test('filters guide sections by user-facing keywords', () => {
    expect(
      filterGuideSections('Automatic Memory').map(item => item.id)
    ).toEqual(['memory', 'troubleshooting']);
    expect(filterGuideSections('文档更新').map(item => item.id)).toEqual([
      'snapshots',
    ]);
  });

  test('keeps the document snapshot warning visible while searching', () => {
    render(<HelpCenterPage />);

    expect(
      screen.getByText('文档更新后，AI Chat 会提醒你新建对话')
    ).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText('搜索使用指南'), {
      target: { value: '权限' },
    });

    expect(screen.getByTestId('guide-section-permissions')).not.toBeNull();
    expect(screen.queryByTestId('guide-section-start')).toBeNull();
    expect(
      screen.getByText('文档更新后，AI Chat 会提醒你新建对话')
    ).not.toBeNull();
  });

  test('opens AI chat and contextual workspace settings', () => {
    render(<HelpCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: '打开 AI Chat' }));
    expect(openWorkbench).toHaveBeenCalledWith('/chat', { at: 'active' });

    fireEvent.click(screen.getByRole('button', { name: '管理 AI 上下文' }));
    expect(openDialog).toHaveBeenCalledWith('setting', {
      activeTab: 'workspace:ai-context',
    });

    fireEvent.click(
      screen.getByRole('button', { name: '打开 Embedding 设置' })
    );
    expect(openDialog).toHaveBeenCalledWith('setting', {
      activeTab: 'workspace:embedding',
    });
  });
});
