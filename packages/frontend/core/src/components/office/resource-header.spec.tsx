/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { OfficeResourceHeader } from './resource-header';

afterEach(cleanup);

describe('OfficeResourceHeader', () => {
  test('keeps common resource actions available to every owner', () => {
    const onDownload = vi.fn();
    const onHistory = vi.fn();
    const onPrint = vi.fn();
    render(
      <OfficeResourceHeader
        title="Quarterly plan"
        kind="document"
        revisionSequence={3}
        latestSequence={3}
        historical={false}
        busy={false}
        returningLatest={false}
        onDownload={onDownload}
        onHistory={onHistory}
        onLatest={vi.fn()}
        onPrint={onPrint}
      />
    );

    expect(screen.getByText('Quarterly plan')).toBeDefined();
    expect(screen.getByText('v3')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revision history' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Download native Office file' })
    );
    expect(onPrint).toHaveBeenCalledOnce();
    expect(onHistory).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Comments and collaborators' })
    ).toBeNull();
  });

  test('exposes owner-supported AI, comments, export, and latest actions', () => {
    const onLatest = vi.fn();
    render(
      <OfficeResourceHeader
        title="Historical plan"
        kind="document"
        revisionSequence={2}
        latestSequence={4}
        historical
        busy={false}
        returningLatest={false}
        onAI={vi.fn()}
        onComments={vi.fn()}
        onDownload={vi.fn()}
        onExportPdf={vi.fn()}
        onHistory={vi.fn()}
        onLatest={onLatest}
        onPrint={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Return to latest Office revision v4',
      })
    );
    expect(onLatest).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Open LocalMind AI' })
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Comments and collaborators' })
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDefined();
  });
});
