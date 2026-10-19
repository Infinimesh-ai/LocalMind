/** @vitest-environment happy-dom */
import {
  BUILTIN_REPORT_TEMPLATES,
  createReportDocument,
  ReportNodeSchema,
} from '@localmind/office/report';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@affine/component', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@affine/core/modules/project-reports/i18n', () => ({
  useReportText: () => (key: string) => key,
}));
import { newReportNode } from '@affine/core/modules/project-reports/edit-state';

import { ReportNodeEditor, ResponsibilityEditor } from './node-editor';
const document = createReportDocument({
  title: 'Report',
  now: '2026-10-08T00:00:00Z',
  creator: { actorId: 'creator', label: 'Same name' },
  period: {
    start: '2026-10-01T00:00:00Z',
    end: '2026-10-08T00:00:00Z',
    timeZone: 'UTC',
    weekStartsOn: 1,
  },
  template: BUILTIN_REPORT_TEMPLATES[0].content,
});
afterEach(cleanup);
it('renders editable controls for every node kind', () => {
  for (const type of [
    'heading',
    'paragraph',
    'list',
    'table',
    'metric',
    'timeline',
    'image',
    'chart',
    'callout',
    'pageBreak',
  ] as const) {
    const { container, unmount } = render(
      <ReportNodeEditor
        node={newReportNode(type)}
        document={document}
        members={[]}
        disabled={false}
        onChange={() => {}}
      />
    );
    expect(container.textContent).not.toBe('');
    unmount();
  }
});
it('keeps an empty metric unknown and accepts an explicit zero', () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <ReportNodeEditor
      node={newReportNode('metric')}
      document={document}
      members={[]}
      disabled={false}
      onChange={onChange}
    />
  );
  const input = screen.getByLabelText('value');
  fireEvent.change(input, { target: { value: '0' } });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ value: 0 })
  );
  rerender(
    <ReportNodeEditor
      node={ReportNodeSchema.parse({ ...newReportNode('metric'), value: 0 })}
      document={document}
      members={[]}
      disabled={false}
      onChange={onChange}
    />
  );
  fireEvent.change(input, { target: { value: '' } });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ value: null })
  );
});
it('disables the structured controls when the report lease is not owned', () => {
  const { container } = render(
    <ReportNodeEditor
      node={ReportNodeSchema.parse({
        id: 'table',
        type: 'table',
        columns: ['One'],
        rows: [['Cell']],
      })}
      document={document}
      members={[]}
      disabled
      onChange={() => {}}
    />
  );
  expect(
    [...container.querySelectorAll('input,textarea,select,button')].every(
      input => input.hasAttribute('disabled')
    )
  ).toBe(true);
});
it('preserves a named external person instead of binding a same-name member', () => {
  const onChange = vi.fn();
  render(
    <ResponsibilityEditor
      value={{
        identity: { kind: 'external', label: 'Same name' },
        origin: 'document',
        sourceIds: [],
      }}
      creator={document.creator}
      members={[{ id: 'other', name: 'Same name' }]}
      disabled={false}
      onChange={onChange}
    />
  );
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
    'external'
  );
  expect(onChange).not.toHaveBeenCalled();
});

it('keeps a former member’s frozen identity without silently changing the assignment', () => {
  const onChange = vi.fn();
  render(
    <ResponsibilityEditor
      value={{
        identity: { kind: 'member', actorId: 'former', label: 'Frozen name' },
        origin: 'document',
        sourceIds: [],
      }}
      creator={document.creator}
      members={[]}
      onChange={onChange}
    />
  );
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
    'former'
  );
  expect(
    screen
      .getByRole('option', { name: 'Frozen name · formerMember' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});
