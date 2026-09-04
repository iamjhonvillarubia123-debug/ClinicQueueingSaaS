import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SecretarySettingsPage } from './SecretarySettingsPage';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ profile: { userId: 'secretary-1', role: 'SECRETARY' } }),
}));

describe('Secretary Settings', () => {
  it('connects existing account/security routes and leaves preferences unconnected', () => {
    render(<MemoryRouter><SecretarySettingsPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Secretary', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view account/i })).toHaveAttribute('href', '/app/secretary/profile');
    expect(screen.getByRole('link', { name: /manage security/i })).toHaveAttribute('href', '/app/account');
    expect(screen.getByRole('button', { name: /manage preferences/i })).toBeDisabled();
    expect(screen.getByText(/do not change clinic operations/i)).toBeInTheDocument();
  });
});
