/**
 * @vitest-environment happy-dom
 */
import {
  adminUserAiProfileAssignmentQuery,
  listUsersQuery,
} from '@affine/graphql';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidate: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  useMutation: vi.fn(),
}));

vi.mock('@affine/admin/use-mutation', () => ({
  useMutateQueryResource: () => mocks.revalidate,
  useMutation: (options: unknown) => mocks.useMutation(options),
}));

vi.mock('sonner', () => ({
  toast: mocks.toast,
}));

import { useCreateUser, useUpdateUser } from './use-user-management';

describe('AI Profile account assignment', () => {
  beforeEach(() => {
    mocks.revalidate.mockReset();
    mocks.revalidate.mockResolvedValue(undefined);
    mocks.toast.mockReset();
    mocks.toast.error.mockReset();
    mocks.useMutation.mockReset();
  });

  test('reports a partial create failure when Profile assignment fails', async () => {
    const createAccount = vi.fn().mockResolvedValue({
      createUser: { id: 'user-1' },
    });
    const updateFeatures = vi.fn().mockResolvedValue(undefined);
    const setAssignment = vi.fn().mockRejectedValue(new Error('denied'));
    mocks.useMutation.mockImplementation(
      (options: { mutation: { op: string } }) => ({
        trigger: {
          createUser: createAccount,
          updateAccountFeatures: updateFeatures,
          setAdminUserAiProfileAssignment: setAssignment,
        }[options.mutation.op],
      })
    );
    const { result } = renderHook(() => useCreateUser());

    act(() => {
      void result.current.create({
        aiProfileId: 'profile-1',
        email: 'user@example.test',
        features: [],
        name: 'User',
        password: '',
      });
    });

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'Account created, but AI Profile assignment failed: denied'
      );
    });
    expect(createAccount).toHaveBeenCalledTimes(1);
    expect(updateFeatures).toHaveBeenCalledWith({
      userId: 'user-1',
      features: [],
    });
    expect(setAssignment).toHaveBeenCalledWith({
      userId: 'user-1',
      profileId: 'profile-1',
    });
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  test('reports a partial update failure when Profile assignment fails', async () => {
    const updateAccount = vi.fn().mockResolvedValue(undefined);
    const updateFeatures = vi.fn().mockResolvedValue(undefined);
    const setAssignment = vi.fn().mockRejectedValue(new Error('denied'));
    mocks.useMutation.mockImplementation(
      (options: { mutation: { op: string } }) => ({
        trigger: {
          updateAccount: updateAccount,
          updateAccountFeatures: updateFeatures,
          setAdminUserAiProfileAssignment: setAssignment,
        }[options.mutation.op],
      })
    );
    const { result } = renderHook(() => useUpdateUser());

    act(() => {
      void result.current.update({
        aiProfileId: 'profile-2',
        email: 'user@example.test',
        features: [],
        name: 'Updated User',
        password: '',
        userId: 'user-1',
      });
    });

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'Account updated, but AI Profile assignment failed: denied'
      );
    });
    expect(updateAccount).toHaveBeenCalledTimes(1);
    expect(updateFeatures).toHaveBeenCalledWith({
      userId: 'user-1',
      features: [],
    });
    expect(setAssignment).toHaveBeenCalledWith({
      userId: 'user-1',
      profileId: 'profile-2',
    });
    expect(mocks.revalidate).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  test('refreshes the saved assignment after a successful account update', async () => {
    const updateAccount = vi.fn().mockResolvedValue(undefined);
    const updateFeatures = vi.fn().mockResolvedValue(undefined);
    const setAssignment = vi.fn().mockResolvedValue(undefined);
    mocks.useMutation.mockImplementation(
      (options: { mutation: { op: string } }) => ({
        trigger: {
          updateAccount,
          updateAccountFeatures: updateFeatures,
          setAdminUserAiProfileAssignment: setAssignment,
        }[options.mutation.op],
      })
    );
    const { result } = renderHook(() => useUpdateUser());

    let updated = false;
    await act(async () => {
      updated = await result.current.update({
        aiProfileId: 'profile-2',
        email: 'user@example.test',
        features: [],
        name: 'Updated User',
        password: '',
        userId: 'user-1',
      });
    });

    expect(updated).toBe(true);
    expect(mocks.revalidate.mock.calls[0][0]).toBe(listUsersQuery);
    expect(mocks.revalidate.mock.calls[1][0]).toBe(
      adminUserAiProfileAssignmentQuery
    );
    expect(mocks.revalidate.mock.calls[1][1]({ userId: 'user-1' })).toBe(true);
    expect(mocks.revalidate.mock.calls[1][1]({ userId: 'user-2' })).toBe(false);
  });
});
