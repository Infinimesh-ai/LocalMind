/** @vitest-environment happy-dom */
import type {
  ProjectReportApi,
  ReportState,
} from '@affine/core/modules/project-reports/contracts';
import { BUILTIN_REPORT_TEMPLATES } from '@localmind/office/report';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@affine/component', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Loading: () => <p>loading</p>,
  useConfirmModal: () => ({
    openConfirmModal: ({ onConfirm }: { onConfirm: () => Promise<void> }) =>
      void onConfirm(),
  }),
}));
vi.mock('@affine/core/modules/project-reports/i18n', () => ({
  useReportText: () => (key: string) => key,
}));

import {
  MemberRecipients,
  reportRecipientLabels,
  zonedDateTime,
} from './configuration';
import { ReportSchedules } from './management';

const members = [{ id: 'member-private-id', name: 'Fictional member' }];
function client(writable = true): ProjectReportApi {
  const state: ReportState = {
    schedules: [],
    templates: [
      {
        id: 'template',
        version: 1,
        name: 'Weekly',
        builtinKey: 'weekly',
        status: 'active',
        current: {
          id: 'template-revision',
          content: BUILTIN_REPORT_TEMPLATES[0].content,
        },
      },
    ],
    members,
    resources: [],
    capabilities: {
      canEdit: writable,
      canSchedule: writable,
      canShare: writable,
      allowAnonymous: false,
      emailConfigured: true,
    },
  };
  return {
    query: vi.fn(async () => state),
    command: vi.fn(async () => ({})),
    download: vi.fn(async () => {}),
  };
}
afterEach(cleanup);
it('creates a schedule from the available template and selects a named member for authorized delivery', async () => {
  const api = client();
  const { container } = render(
    <ReportSchedules api={api} projectId="project" />
  );
  fireEvent.click(await screen.findByText('newSchedule'));
  expect((screen.getByLabelText('template') as HTMLSelectElement).value).toBe(
    'template-revision'
  );
  fireEvent.change(screen.getByLabelText('title'), {
    target: { value: 'Fictional weekly report' },
  });
  fireEvent.click(screen.getByLabelText('automaticDelivery'));
  const recipients = screen.getByLabelText(
    'memberRecipients'
  ) as HTMLSelectElement;
  recipients.options[0].selected = true;
  fireEvent.change(recipients);
  const chapter = screen
    .getByText(BUILTIN_REPORT_TEMPLATES[0].content.chapters[0].title)
    .closest('label')!
    .querySelector('input')!;
  fireEvent.click(chapter);
  expect(container.textContent).not.toContain('member-private-id');
  fireEvent.click(screen.getByText('saveSchedule'));
  await waitFor(() => expect(api.command).toHaveBeenCalledOnce());
  expect(api.command).toHaveBeenCalledWith(
    expect.objectContaining({
      command: expect.objectContaining({
        operation: 'schedule.save',
        config: expect.objectContaining({
          templateRevisionId: 'template-revision',
          delivery: expect.objectContaining({
            recipients: ['member-private-id'],
          }),
        }),
      }),
    })
  );
});
it('disables new schedules when project writes or scheduling are unavailable', async () => {
  const api = client(false);
  render(<ReportSchedules api={api} projectId="project" />);
  const button = await screen.findByText('newSchedule');
  expect(button.hasAttribute('disabled')).toBe(true);
  fireEvent.click(button);
  expect(screen.queryByLabelText('title')).toBeNull();
  expect(api.command).not.toHaveBeenCalled();
});
it('keeps legacy external accounts selected without showing their internal identifiers', () => {
  const onChange = vi.fn();
  const { container } = render(
    <MemberRecipients
      value={['legacy-private-id']}
      members={members}
      onChange={onChange}
    />
  );
  expect(container.textContent).not.toContain('legacy-private-id');
  expect(
    reportRecipientLabels(
      ['member-private-id', 'legacy-private-id', 'fictional@example.invalid'],
      members,
      'Unavailable'
    )
  ).toEqual(['Fictional member', 'Unavailable 2', 'fictional@example.invalid']);
  expect(onChange).not.toHaveBeenCalled();
});
it('converts history dates in the schedule time zone and rejects nonexistent local time', () => {
  expect(zonedDateTime('2026-10-05T00:00', 'Asia/Shanghai')).toBe(
    '2026-10-04T16:00:00.000Z'
  );
  expect(() =>
    zonedDateTime('2026-03-08T02:30', 'America/Los_Angeles')
  ).toThrow('does not exist');
});
