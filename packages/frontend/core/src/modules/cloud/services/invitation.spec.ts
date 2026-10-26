import { Framework } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

import type { AcceptInviteStore } from '../stores/accept-invite';
import type { InviteInfoStore } from '../stores/invite-info';
import { InvitationService } from './invitation';

const services: InvitationService[] = [];
function createService(
  acceptInvite: AcceptInviteStore['acceptInvite'],
  getInviteInfo: InviteInfoStore['getInviteInfo']
) {
  const framework = new Framework();
  framework.service(
    InvitationService,
    () =>
      new InvitationService(
        { acceptInvite } as unknown as AcceptInviteStore,
        { getInviteInfo } as unknown as InviteInfoStore
      )
  );
  const service = framework.provider().get(InvitationService);
  services.push(service);
  return service;
}
afterEach(() => {
  services.splice(0).forEach(service => service.dispose());
});

test('acceptance preserves lookup errors and never submits a missing invitation', async () => {
  const failure = new Error('lookup failed');
  const getInviteInfo = vi.fn().mockRejectedValue(failure);
  const acceptInvite = vi.fn();
  const service = createService(acceptInvite, getInviteInfo);
  await expect(service.acceptInvite('missing')).rejects.toBe(failure);
  expect(acceptInvite).not.toHaveBeenCalled();
});

test('concurrent invitations remain bound to their own lookup results', async () => {
  let first: (value: unknown) => void = (_value: unknown) => undefined;
  const getInviteInfo = vi.fn().mockImplementation((id: string) =>
    id === 'first'
      ? new Promise(done => {
          first = done;
        })
      : Promise.resolve({ workspace: { id: 'workspace-second' } })
  );
  const acceptInvite = vi.fn().mockResolvedValue(true);
  const service = createService(acceptInvite, getInviteInfo);
  const pending = service.acceptInvite('first');
  await service.acceptInvite('second');
  first({ workspace: { id: 'workspace-first' } });
  await pending;
  expect(acceptInvite.mock.calls).toEqual([
    ['workspace-second', 'second'],
    ['workspace-first', 'first'],
  ]);
});
