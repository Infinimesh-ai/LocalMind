/** @vitest-environment happy-dom */
import type { Notification } from '@affine/core/modules/notification';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  legacyReports: false,
  readNotification: vi.fn(async () => {}),
}));
vi.mock('@affine/component', () => ({
  Button: ({ children, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick}>{children}</button>
  ),
  notify: { error: vi.fn() },
}));
vi.mock('@affine/core/components/report-deck-entry', () => ({
  useLegacyProjectReportsEnabled: () => state.legacyReports,
}));
vi.mock('@affine/core/modules/notification', () => ({
  NotificationListService: class {},
}));
vi.mock('@affine/core/modules/project-reports/i18n', () => ({
  useReportText: () => (key: string) => key,
}));
vi.mock('@toeverything/infra', () => ({
  useService: () => ({ readNotification: state.readNotification }),
}));
vi.mock('./cleanup-actions', () => ({ NotificationItemActions: () => null }));

import { ProjectReportNotificationItem } from './project-report';

afterEach(() => {
  cleanup();
  state.legacyReports = false;
});

const CurrentPath = () => {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
};

function open(body: Record<string, unknown>) {
  render(
    <MemoryRouter initialEntries={['/workspace/ws/all']}>
      <ProjectReportNotificationItem
        notification={{ id: 'n1', body } as unknown as Notification}
      />
      <CurrentPath />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'open' }));
  return screen.getByTestId('path').textContent;
}

const report = {
  projectId: 'p1',
  reportId: 'r1',
  status: 'completed',
  title: 'Weekly',
};

test('report links open the report decks home while the legacy studio is off', () => {
  expect(open(report)).toBe('/reports');
  cleanup();
  expect(open({ ...report, url: '/share/reports/s1' })).toBe(
    '/share/reports/s1'
  );
});

test('report links keep opening the legacy studio while it is enabled', () => {
  state.legacyReports = true;
  expect(open(report)).toBe('/project/p1/reports/r1');
});
