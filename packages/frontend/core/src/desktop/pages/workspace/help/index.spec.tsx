/**
 * @vitest-environment happy-dom
 */

import { NavigateContext } from '@affine/core/components/hooks/use-navigate-helper';
import type * as I18nModule from '@affine/i18n';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { HelpCenterPage } from './index';

const navigate = vi.hoisted(() => vi.fn());
const openDialog = vi.hoisted(() => vi.fn());
const WorkspaceDialogServiceToken = vi.hoisted(
  () => class WorkspaceDialogService {}
);

vi.mock('@affine/i18n', async importOriginal => {
  const actual = await importOriginal<typeof I18nModule>();
  const messages = actual.SUPPORTED_LANGUAGES.en.resource;
  if (typeof messages === 'function')
    throw new Error('English must be bundled');
  const translate = (key: string, params?: Record<string, string | number>) => {
    let value = messages[key as keyof typeof messages] ?? key;
    for (const [name, replacement] of Object.entries(params ?? {})) {
      value = value.replaceAll(`{{${name}}}`, String(replacement));
    }
    return value;
  };
  const wrapper = new Proxy(
    {},
    { get: (_, key: string) => () => translate(key) }
  );
  return {
    ...actual,
    useI18n: () => wrapper,
    useTranslation: () => ({ t: translate }),
  };
});

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

vi.mock('@affine/core/components/hooks/use-navigate-helper', async () => {
  const { createContext } = await import('react');
  return { NavigateContext: createContext(null) };
});

vi.mock('@affine/core/modules/workbench', () => ({
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
    if (token === WorkspaceDialogServiceToken) {
      return { open: openDialog };
    }
    return {};
  },
}));

describe('LocalMind help center', () => {
  afterEach(cleanup);

  beforeEach(() => {
    navigate.mockReset();
    openDialog.mockReset();
  });

  test('ordinary readers can browse administrator instructions without admin services', () => {
    render(<HelpCenterPage />);
    expect(screen.getByTestId('guide-section-admin')).not.toBeNull();
    expect(
      screen.getByTestId('guide-article-admin-project-ai').hasAttribute('open')
    ).toBe(false);
    expect(
      screen.getByTestId('guide-article-start-first').hasAttribute('open')
    ).toBe(true);
    expect(openDialog).not.toHaveBeenCalled();
  });

  test('searches collapsed instructions and expands matching articles', () => {
    render(<HelpCenterPage />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'LOCALMIND_MCP_RESOURCES_ENABLED' },
    });
    expect(
      screen
        .getByTestId('guide-article-admin-integrations')
        .hasAttribute('open')
    ).toBe(true);
    expect(screen.queryByTestId('guide-section-start')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(
      'Matching topics: 1'
    );
  });

  test('clears an empty result and restores the table of contents', () => {
    render(<HelpCenterPage />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'unmatched-query-78231' },
    });
    expect(screen.queryAllByTestId(/^guide-section-/)).toHaveLength(0);
    const clearButtons = screen.getAllByRole('button', {
      name: 'Clear search',
    });
    fireEvent.click(clearButtons[clearButtons.length - 1]);
    expect(screen.getAllByTestId(/^guide-section-/)).toHaveLength(6);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });

  test('restores manual disclosure state after a search', async () => {
    render(<HelpCenterPage />);
    const article = screen.getByTestId(
      'guide-article-admin-project-ai'
    ) as HTMLDetailsElement;
    article.open = true;
    fireEvent(article, new Event('toggle', { bubbles: true }));
    await waitFor(() => expect(article.open).toBe(true));
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'SMTP' },
    });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(
      (
        screen.getByTestId(
          'guide-article-admin-project-ai'
        ) as HTMLDetailsElement
      ).open
    ).toBe(true);
    expect(
      (
        screen.getByTestId(
          'guide-article-admin-integrations'
        ) as HTMLDetailsElement
      ).open
    ).toBe(false);
  });

  test('opens the existing project hub and workspace settings', () => {
    render(
      <NavigateContext.Provider value={navigate}>
        <HelpCenterPage />
      </NavigateContext.Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Project hub' }));
    expect(navigate).toHaveBeenCalledWith('/project');
    fireEvent.click(screen.getByRole('button', { name: 'Manage AI context' }));
    expect(openDialog).toHaveBeenCalledWith('setting', {
      activeTab: 'workspace:ai-context',
    });
  });

  test('uses unique, working anchors when two help views are open', () => {
    render(
      <>
        <HelpCenterPage />
        <HelpCenterPage />
      </>
    );
    const sections = screen.getAllByTestId(/^guide-section-/);
    const ids = sections.map(section => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    const links = screen.getAllByRole('link');
    for (const link of links) {
      expect(ids).toContain(link.getAttribute('href')?.slice(1));
    }
  });
});
