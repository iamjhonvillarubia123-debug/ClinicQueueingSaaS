import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPasswordPage } from './PasswordRecoveryPages';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ForgotPasswordPage', () => {
  it('keeps unknown-account responses non-enumerating without claiming a reset was sent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ accepted: true }));
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Mobile # or email address'), 'unknown@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your messages' })).toBeInTheDocument();
    expect(screen.getByText('unknown@example.com')).toBeInTheDocument();
    expect(screen.getByText(/if an eligible account matches/i)).toBeInTheDocument();
    expect(screen.getByText(/password-reset instructions will be sent/i)).toBeInTheDocument();
    expect(screen.getByText(/if you do not have an account yet, create one/i)).toBeInTheDocument();
    expect(screen.queryByText(/a password reset link has been sent/i)).not.toBeInTheDocument();
  });
});
