import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';

const loginMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ status: 'anonymous', login: loginMock }),
}));

afterEach(() => {
  cleanup();
  loginMock.mockClear();
  localStorage.clear();
});

describe('approved sign-in experience', () => {
  it('preserves the approved account access paths without public Secretary registration', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('link', { name: 'Create Account' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Reactivate Account' })).toHaveAttribute('href', '/account/reactivate');
    expect(screen.queryByRole('link', { name: /create secretary/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeDisabled();
    expect(screen.getByText(/Google sign-in is coming soon/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/remember me/i)).toBeInTheDocument();
    expect(screen.getByText(/Only your email address is remembered/i)).toBeInTheDocument();
  });

  it('toggles password visibility without changing the password value', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    const password = screen.getByLabelText('Password');

    await user.type(password, 'private password');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('private password');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('submits through the existing login flow and honors the protected destination', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/app/clinics' } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app/clinics" element={<div>Clinics destination</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email address'), 'doctor@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(loginMock).toHaveBeenCalledWith('doctor@example.com', 'secret-password');
    expect(await screen.findByText('Clinics destination')).toBeInTheDocument();
  });

  it('remembers only the email address when requested', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    await user.type(screen.getByLabelText('Email address'), 'staff@example.com');
    await user.type(screen.getByLabelText('Password'), 'never-store-this');
    await user.click(screen.getByLabelText('Remember me'));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(localStorage.getItem('clinic-queueing.remembered-email')).toBe('staff@example.com');
    expect(JSON.stringify(localStorage)).not.toContain('never-store-this');
  });
});
