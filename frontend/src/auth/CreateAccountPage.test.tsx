import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CreateAccountPage } from './CreateAccountPage';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('approved create account UI', () => {
  it('shows the shared Doctor and Secretary registration choices', () => {
    render(<MemoryRouter><CreateAccountPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Doctor/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Secretary/i })).not.toBeChecked();
    expect(screen.getByPlaceholderText('Enter your first name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your last name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your mobile number')).toBeInTheDocument();
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Uppercase letter')).toBeInTheDocument();
    expect(screen.getByText('Lowercase letter')).toBeInTheDocument();
    expect(screen.getByText('Number')).toBeInTheDocument();
    expect(screen.getByText('Special character')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('allows switching the visible account type without creating clinic authority', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CreateAccountPage /></MemoryRouter>);

    await user.click(screen.getByRole('radio', { name: /Secretary/i }));

    expect(screen.getByRole('radio', { name: /Secretary/i })).toBeChecked();
    expect(screen.getByText(/Work with clinics that assign you as a Secretary/i)).toBeInTheDocument();
    expect(screen.queryByText(/PracticeLocation/i)).not.toBeInTheDocument();
  });

  it('keeps account creation blocked until the shared password requirements are met', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CreateAccountPage /></MemoryRouter>);

    const password = screen.getByPlaceholderText('Create a password');
    const confirmation = screen.getByPlaceholderText('Re-enter your password');
    const submit = screen.getByRole('button', { name: 'Create account' });

    await user.type(password, 'weakpassword');
    await user.type(confirmation, 'weakpassword');
    expect(submit).toBeDisabled();

    await user.clear(password);
    await user.clear(confirmation);
    await user.type(password, 'ExamplePass1!');
    await user.type(confirmation, 'ExamplePass1!');
    expect(submit).toBeEnabled();
  });

  it('registers the selected role and moves to the approved check-email UI', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      userId: 'user-1',
      role: 'SECRETARY',
      emailVerificationRequired: true,
      emailVerificationExpiresAt: '2026-09-01T00:00:00.000Z',
    }));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<CreateAccountPage />} />
          <Route path="/registration/check-email" element={<div>Check email destination</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('radio', { name: /Secretary/i }));
    await user.type(screen.getByPlaceholderText('Enter your first name'), 'Maria');
    await user.type(screen.getByPlaceholderText('Enter your last name'), 'Santos');
    await user.type(screen.getByPlaceholderText('Enter your email address'), 'secretary@example.com');
    await user.type(screen.getByPlaceholderText('Enter your mobile number'), '09171234567');
    await user.type(screen.getByPlaceholderText('Create a password'), 'ExamplePass1!');
    await user.type(screen.getByPlaceholderText('Re-enter your password'), 'ExamplePass1!');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Check email destination')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/register');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('"role":"SECRETARY"');
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('PracticeStaff');
  }, 10000);

  it('preserves the approved authentication branding panel content', () => {
    render(<MemoryRouter><CreateAccountPage /></MemoryRouter>);

    expect(screen.getByText(/Smart queueing/i)).toBeInTheDocument();
    expect(screen.getByText(/Better patient care/i)).toBeInTheDocument();
    expect(screen.getByText('Organize Appointments')).toBeInTheDocument();
    expect(screen.getByText('Real-time Queue')).toBeInTheDocument();
    expect(screen.getByText('Secure & Reliable')).toBeInTheDocument();
  });
});
