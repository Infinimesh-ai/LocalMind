/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  signInPassword: vi.fn().mockResolvedValue(undefined),
  t: new Proxy({}, { get: (_, key) => () => String(key) }),
}));

vi.mock('@affine/component', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@affine/component/auth-components', () => ({
  AuthContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AuthContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AuthFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AuthHeader: () => null,
  AuthInput: ({
    endFix,
    onChange,
    error: _error,
    errorHint: _errorHint,
    onEnter: _onEnter,
    label: _label,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    endFix?: ReactNode;
    onChange?: (value: string) => void;
    error?: boolean;
    errorHint?: ReactNode;
    onEnter?: () => void;
    label?: string;
  }) => (
    <div>
      <input {...props} onChange={event => onChange?.(event.target.value)} />
      {endFix}
    </div>
  ),
}));
vi.mock('@affine/component/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  IconButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@affine/core/components/hooks/affine-async-hooks', () => ({
  useAsyncCallback: (callback: () => void) => callback,
}));
vi.mock('@affine/core/modules/cloud', () => ({
  AuthService: class AuthService {},
  CaptchaService: class CaptchaService {},
  ServerService: class ServerService {},
  getSelfHostedServerName: (name: string) => name,
}));
vi.mock('@toeverything/infra', () => ({
  useService: (service: { name: string }) => {
    if (service.name === 'AuthService') {
      return {
        // The mock keeps the production observable property names.
        // eslint-disable-next-line rxjs/finnish
        session: { status$: 'unauthenticated' },
        signInPassword: state.signInPassword,
      };
    }
    if (service.name === 'CaptchaService') {
      // eslint-disable-next-line rxjs/finnish
      return { verifyToken$: null, needCaptcha$: false, challenge$: null };
    }
    // eslint-disable-next-line rxjs/finnish
    return { server: { config$: { selector: () => null } } };
  },
  useLiveData: (value: unknown) => value,
}));
vi.mock('@affine/i18n', () => ({ useI18n: () => state.t }));
vi.mock('./back', () => ({ Back: () => null }));
vi.mock('./captcha', () => ({ Captcha: () => null }));

import { SignInWithPasswordStep } from './sign-in-with-password';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('toggles password visibility without submitting or changing the password', () => {
  render(
    <SignInWithPasswordStep
      state={{ email: 'user@example.com', step: 'signInWithPassword' }}
      changeState={vi.fn()}
    />
  );

  const input = screen.getByTestId('password-input') as HTMLInputElement;
  expect(input.type).toBe('password');
  fireEvent.change(input, { target: { value: 'secret' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'com.affine.auth.password.show' })
  );
  expect(input.type).toBe('text');
  expect(input.value).toBe('secret');
  expect(state.signInPassword).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'com.affine.auth.password.hide' })
  );
  expect(input.type).toBe('password');
  expect(input.value).toBe('secret');
});
