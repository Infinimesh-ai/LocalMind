/** @vitest-environment happy-dom */
import { cleanup, render, screen, within } from '@testing-library/react';
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
