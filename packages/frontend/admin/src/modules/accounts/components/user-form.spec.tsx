/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const createUserMock = vi.fn();

vi.mock('@affine/admin/use-query', () => ({
  useQuery: () => ({
    data: {
      adminAiProfiles: [
        {
          id: 'profile-1',
          workspaceId: 'workspace-1',
          workspaceName: 'Engineering',
          name: 'Engineering default',
          description: null,
          enabled: true,
          isDefault: true,
          credentialIds: [],
          credentials: [],
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    },
    error: undefined,
    isValidating: false,
  }),
}));

vi.mock('../../common', () => ({
  useServerConfig: () => ({
    availableUserFeatures: [],
    credentialsRequirement: {
      password: {
        minLength: 8,
        maxLength: 32,
      },
    },
  }),
}));

vi.mock('./use-user-management', () => ({
  useCreateUser: () => ({
    create: createUserMock,
    creating: false,
  }),
  useUpdateUser: () => ({
    update: vi.fn(),
    updating: false,
  }),
}));

vi.mock('../../../components/shared/feature-toggle-list', () => ({
  FeatureToggleList: () => null,
}));

vi.mock('../../header', () => ({
  RightPanelHeader: ({
    canSave,
    handleConfirm,
  }: {
    canSave: boolean;
    handleConfirm: () => void;
  }) => (
    <button type="button" disabled={!canSave} onClick={handleConfirm}>
      Save
    </button>
  ),
}));

import { CreateUserForm } from './user-form';

describe('CreateUserForm', () => {
  beforeEach(() => {
    createUserMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test('shows the password limits and masks the password input', () => {
    render(<CreateUserForm onComplete={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/Password/);

    expect(passwordInput.getAttribute('type')).toBe('password');
    expect(passwordInput.getAttribute('minlength')).toBe('8');
    expect(passwordInput.getAttribute('maxlength')).toBe('32');
    expect(
      screen.queryByText('Use 8–32 characters, or leave blank.')
    ).not.toBeNull();
  });

  test('disables save and explains how to fix a short password', () => {
    render(<CreateUserForm onComplete={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('User name'), {
      target: { value: 'Example User' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'example@localmind.test' },
    });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    const passwordInput = screen.getByLabelText(/Password/);

    expect(saveButton.hasAttribute('disabled')).toBe(false);

    fireEvent.change(passwordInput, {
      target: { value: 'short' },
    });

    expect(saveButton.hasAttribute('disabled')).toBe(true);
    expect(passwordInput.getAttribute('aria-invalid')).toBe('true');
    expect(
      screen.queryByText('Password must be between 8 and 32 characters.')
    ).not.toBeNull();

    fireEvent.change(passwordInput, {
      target: { value: 'long-enough' },
    });

    expect(saveButton.hasAttribute('disabled')).toBe(false);
    expect(passwordInput.hasAttribute('aria-invalid')).toBe(false);
  });

  test('submits the selected default AI Profile', () => {
    render(<CreateUserForm onComplete={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('User name'), {
      target: { value: 'Example User' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'example@localmind.test' },
    });
    fireEvent.click(screen.getByLabelText('Default AI Profile'));
    fireEvent.click(
      screen.getByRole('option', {
        name: 'Engineering default / Engineering',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ aiProfileId: 'profile-1' })
    );
  });
});
