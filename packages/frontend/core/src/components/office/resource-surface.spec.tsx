/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { OfficeResourceAdapter } from './resource-adapter';
import type { OfficeResourceSession } from './resource-session';
import { OfficeResourceSurface } from './resource-surface';

vi.mock('./revision-history', () => ({ OfficeRevisionHistory: () => null }));
vi.mock('./editor-surface', () => ({ OfficeEditorSurface: () => <main /> }));
afterEach(cleanup);

describe('Office session status placement', () => {
  test.each<[Partial<OfficeResourceSession>, string]>([
    [{}, 'Saved'],
    [{ unsaved: true }, 'Unsaved changes'],
    [{ busy: true }, 'Saving'],
    [{ historical: true }, 'Historical revision, read only'],
    [{ conflict: true }, 'The file changed. Reload and compare before saving.'],
  ])('keeps %s in the header, outside the editor body', (overrides, text) => {
    const revision = { id: 'r1', sequence: 1 };
    const session = {
      artifact: {
        title: 'Plan.docx',
        kind: 'document',
        currentRevision: revision,
      },
      revision,
      state: {},
      status: 'ready',
      ...overrides,
    } as OfficeResourceSession;
    render(
      <OfficeResourceSurface
        adapter={
          {
            owner: { kind: 'workspace', workspaceId: 'w' },
          } as OfficeResourceAdapter
        }
        session={session}
        graphql={{} as never}
        capabilities={{
          canEdit: true,
          canDownload: true,
          canPrint: true,
          canExportPdf: true,
          canViewHistory: true,
          canComment: false,
          canUseAI: false,
        }}
      >
        {({ header, body }) => (
          <>
            <header>{header}</header>
            <section aria-label="Editor body">{body}</section>
          </>
        )}
      </OfficeResourceSurface>
    );
    expect(
      within(screen.getByRole('banner')).getByRole('status').textContent
    ).toBe(text);
    expect(within(screen.getByRole('region')).queryByRole('status')).toBeNull();
    expect(screen.getByRole('main')).toBeDefined();
  });
});

test.each([false, true])(
  'compatible download uses the displayed revision, including history=%s',
  historical => {
    const revision = {
      id: historical ? 'old' : 'current',
      sequence: historical ? 1 : 2,
    };
    const artifact = {
      id: 'book',
      title: 'Budget.xlsx',
      kind: 'workbook',
      currentRevision: { id: 'current', sequence: 2 },
    };
    const exportWorkbookCopy = vi.fn().mockResolvedValue(undefined),
      download = vi.fn().mockResolvedValue(undefined);
    const session = {
      artifact,
      revision,
      state: {},
      status: 'ready',
      historical,
      busy: false,
      run: (operation: () => Promise<void>) => operation(),
    } as unknown as OfficeResourceSession;
    const adapter = {
      owner: { kind: 'workspace', workspaceId: 'w' },
      exportWorkbookCopy,
      download,
    } as unknown as OfficeResourceAdapter;
    const capabilities = {
      canEdit: !historical,
      canDownload: true,
      canPrint: false,
      canExportPdf: false,
      canViewHistory: true,
      canComment: false,
      canUseAI: false,
    };
    const view = render(
      <OfficeResourceSurface
        adapter={adapter}
        session={session}
        graphql={{} as never}
        capabilities={capabilities}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Download compatible copy' })
    );
    expect(exportWorkbookCopy).toHaveBeenCalledWith(artifact, revision);
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Download original revision' })
    );
    expect(download).toHaveBeenCalledWith(artifact, revision);
    view.rerender(
      <OfficeResourceSurface
        adapter={adapter}
        session={{ ...session, busy: true }}
        graphql={{} as never}
        capabilities={capabilities}
      />
    );
    expect(
      screen
        .getByRole('button', { name: 'Download compatible copy' })
        .hasAttribute('disabled')
    ).toBe(true);
    view.rerender(
      <OfficeResourceSurface
        adapter={adapter}
        session={session}
        graphql={{} as never}
        capabilities={{ ...capabilities, canDownload: false }}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Download compatible copy' })
    ).toBeNull();
  }
);
