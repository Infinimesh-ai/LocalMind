/** @vitest-environment happy-dom */
import type { InviteTeamMemberModalProps } from '@affine/component/member-components';
import { getOrCreateI18n } from '@affine/i18n';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  notify: vi.fn(),
  refreshMembers: vi.fn(),
  refreshQuota: vi.fn(),
}));

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    prefix: _prefix,
    variant: _variant,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      prefix?: unknown;
      variant?: string;
    }
  >) => <button {...props}>{children}</button>,
  notify: mocks.notify,
  useConfirmModal: () => ({
    openConfirmModal: vi.fn(),
    closeConfirmModal: vi.fn(),
  }),
}));
vi.mock('@affine/component/member-components', () => ({
  InviteTeamMemberModal: (props: InviteTeamMemberModalProps) =>
    props.open ? (
      <section aria-label="invite">
        <input
          aria-label="emails"
          value={props.inviteEmails}
          disabled={props.isMutating}
          onChange={event => props.setInviteEmails(event.target.value)}
        />
        <button
          disabled={props.isMutating}
          onClick={() =>
            props.onConfirm({ emails: props.inviteEmails.split(',') })
          }
        >
          send
        </button>
        {props.importCSV}
        {props.errors?.length ? (
          <div role="alert">{props.errors.join('\n')}</div>
        ) : null}
      </section>
    ) : null,
  MemberLimitModal: () => null,
}));
vi.mock('@affine/component/setting-components', () => ({
  SettingRow: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@affine/core/components/pure/file-upload', () => ({
  Upload: ({
    children,
    fileChange,
  }: PropsWithChildren<{ fileChange: (file: File) => void }>) => (
    <div>
      {children}
      <input
        type="file"
        aria-label="csv"
        onChange={event => {
          if (event.target.files?.[0]) fileChange(event.target.files[0]);
        }}
      />
    </div>
  ),
}));
vi.mock('@affine/core/modules/cloud', () => ({
  ServerService: class ServerService {},
  SubscriptionService: class SubscriptionService {},
  WorkspaceSubscriptionService: class WorkspaceSubscriptionService {},
}));
vi.mock('@affine/core/modules/permissions', () => ({
  WorkspaceMembersService: class WorkspaceMembersService {},
  WorkspacePermissionService: class WorkspacePermissionService {},
}));
vi.mock('@affine/core/modules/quota', () => ({
  WorkspaceQuotaService: class WorkspaceQuotaService {},
}));
vi.mock('@affine/core/modules/share-setting', () => ({
  WorkspaceShareSettingService: class WorkspaceShareSettingService {},
}));
vi.mock('@affine/core/utils/clipboard', () => ({
  copyTextToClipboard: vi.fn(),
}));
vi.mock('@affine/track', () => ({ track: {} }));
vi.mock('./member-list', () => ({
  MemberList: () => null,
  MemberListError: () => null,
  MemberListFallback: () => null,
}));
vi.mock('@toeverything/infra', () => {
  const services = new Map<string, unknown>();
  return {
    useLiveData: (value: unknown) => value,
    useService: (service: { name: string }) => {
      if (services.has(service.name)) return services.get(service.name);
      const create = () => {
        switch (service.name) {
          case 'WorkspaceShareSettingService':
            return {
              sharePreview: {
                ['inviteLink$']: null,
                revalidateInviteLink: vi.fn(),
              },
            };
          case 'WorkspaceSubscriptionService':
            return { subscription: { ['subscription$']: null } };
          case 'ServerService':
            return {
              server: {
                ['features$']: { map: () => false },
                ['config$']: { selector: () => true },
              },
            };
          case 'SubscriptionService':
            return { subscription: { ['pro$']: { map: () => null } } };
          case 'WorkspacePermissionService':
            return {
              permission: {
                ['isOwner$']: true,
                ['isAdmin$']: false,
                revalidate: vi.fn(),
              },
            };
          case 'WorkspaceMembersService':
            return {
              inviteMembers: mocks.invite,
              members: { revalidate: mocks.refreshMembers },
            };
          case 'WorkspaceQuotaService':
            return {
              quota: {
                revalidate: mocks.refreshQuota,
                ['isRevalidating$']: false,
                ['error$']: null,
                ['quota$']: {
                  memberLimit: 10,
                  memberCount: 1,
                  humanReadable: { name: 'Test', memberLimit: '10' },
                },
              },
            };
          default:
            throw new Error(`Unexpected service ${service.name}`);
        }
      };
      const value = create();
      services.set(service.name, value);
      return value;
    },
  };
});

import { CloudWorkspaceMembersPanel } from './cloud-members-panel';

beforeAll(async () => {
  await getOrCreateI18n().changeLanguage('zh-Hans');
});
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

const failure = (name: string) => ({
  name,
  type: name,
  code: name,
  message: 'do not display raw server text',
});
function open(emails: string) {
  render(<CloudWorkspaceMembersPanel onChangeSettingState={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'emails' }), {
    target: { value: emails },
  });
}
function send() {
  fireEvent.click(screen.getByRole('button', { name: 'send' }));
}

describe('workspace invitation results', () => {
  test('normalizes and deduplicates addresses and counts only persisted invitations', async () => {
    mocks.invite.mockResolvedValue([
      { email: 'b@example.test', inviteId: 'invite-1', error: null },
    ]);
    open(' B@EXAMPLE.TEST , b@example.test ');
    send();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'invite' })).toBeNull()
    );
    expect(mocks.invite).toHaveBeenCalledWith(['b@example.test']);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: '已创建 1 条邀请' })
    );
  });

  test('existing member failure stays open with the address and no success toast', async () => {
    mocks.invite.mockResolvedValue([
      {
        email: 'b@example.test',
        inviteId: null,
        error: failure('ALREADY_IN_SPACE'),
      },
    ]);
    open('b@example.test');
    send();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('本次未新建邀请')
    );
    expect(
      (screen.getByRole('textbox', { name: 'emails' }) as HTMLInputElement)
        .value
    ).toBe('b@example.test');
    expect(
      (screen.getByRole('button', { name: 'send' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'emails' }), {
      target: { value: 'c@example.test' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('partial success removes successful addresses and retries only the remaining draft', async () => {
    mocks.invite
      .mockResolvedValueOnce([
        { email: 'b@example.test', inviteId: 'invite-b', error: null },
        {
          email: 'c@example.test',
          inviteId: null,
          error: failure('NO_MORE_SEAT'),
        },
      ])
      .mockResolvedValueOnce([
        { email: 'c@example.test', inviteId: 'invite-c', error: null },
      ]);
    open('b@example.test,c@example.test');
    send();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        '已无可用成员名额'
      )
    );
    expect(
      (screen.getByRole('textbox', { name: 'emails' }) as HTMLInputElement)
        .value
    ).toBe('c@example.test');
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: '已创建 1 条邀请' })
    );
    send();
    await waitFor(() => expect(mocks.invite).toHaveBeenCalledTimes(2));
    expect(mocks.invite.mock.calls[1]).toEqual([['c@example.test']]);
  });

  test('request rejection clears loading, retains draft, refreshes membership and permits a later retry', async () => {
    mocks.invite
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([
        { email: 'b@example.test', inviteId: 'invite-b', error: null },
      ]);
    open('b@example.test');
    send();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        '请先查看成员列表'
      )
    );
    expect(
      (screen.getByRole('button', { name: 'send' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(
      (screen.getByRole('textbox', { name: 'emails' }) as HTMLInputElement)
        .value
    ).toBe('b@example.test');
    expect(mocks.refreshMembers).toHaveBeenCalledTimes(2);
    send();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'invite' })).toBeNull()
    );
  });

  test('inflight submission cannot be duplicated', async () => {
    let resolve: (value: unknown) => void = (_value: unknown) => undefined;
    mocks.invite.mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    open('b@example.test');
    act(() => {
      send();
      send();
    });
    expect(mocks.invite).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole('textbox', { name: 'emails' }) as HTMLInputElement)
        .disabled
    ).toBe(true);
    await act(async () =>
      resolve([{ email: 'b@example.test', inviteId: 'invite-b', error: null }])
    );
  });

  test('empty input and unconfirmed result do not report success', async () => {
    open(' , ');
    send();
    expect(mocks.invite).not.toHaveBeenCalled();
    mocks.invite.mockResolvedValue([]);
    fireEvent.change(screen.getByRole('textbox', { name: 'emails' }), {
      target: { value: 'b@example.test' },
    });
    send();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        '无法确认邀请结果'
      )
    );
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  test('CSV request remains busy until the invitation resolves and keeps failed addresses', async () => {
    let resolve: (value: unknown) => void = (_value: unknown) => undefined;
    mocks.invite.mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    open('');
    const file = new File(['b@example.test'], 'invite.csv', {
      type: 'text/csv',
    });
    fireEvent.change(screen.getByLabelText('csv'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(mocks.invite).toHaveBeenCalledTimes(1));
    expect(
      (screen.getByRole('button', { name: 'send' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await act(async () =>
      resolve([
        {
          email: 'b@example.test',
          inviteId: null,
          error: failure('ALREADY_IN_SPACE'),
        },
      ])
    );
    expect(screen.getByRole('alert').textContent).toContain('本次未新建邀请');
    expect(
      (screen.getByRole('button', { name: 'send' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });
  test('CSV reading prevents a concurrent import or email submission', async () => {
    let resolve: (value: string) => void = (_value: string) => undefined;
    const text = vi.fn(
      () =>
        new Promise<string>(done => {
          resolve = done;
        })
    );
    const file = new File([], 'delayed.csv', { type: 'text/csv' });
    vi.spyOn(file, 'text').mockImplementation(text);
    mocks.invite.mockResolvedValue([
      { email: 'b@example.test', inviteId: 'invite-b', error: null },
    ]);
    open('c@example.test');
    fireEvent.change(screen.getByLabelText('csv'), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText('csv'), {
      target: { files: [file] },
    });
    send();
    expect(text).toHaveBeenCalledTimes(1);
    expect(mocks.invite).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'send' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await act(async () => resolve('b@example.test'));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'invite' })).toBeNull()
    );
    expect(mocks.invite).toHaveBeenCalledWith(['b@example.test']);
  });
  test('quota rejection is explicit and leaves the draft editable', async () => {
    mocks.invite.mockRejectedValue(failure('TOO_MANY_REQUEST'));
    open('b@example.test');
    send();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('频率或配额限制')
    );
    expect(
      (screen.getByRole('button', { name: 'send' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(
      (screen.getByRole('textbox', { name: 'emails' }) as HTMLInputElement)
        .value
    ).toBe('b@example.test');
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
