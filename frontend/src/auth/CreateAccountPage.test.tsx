import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CreateAccountPage } from './CreateAccountPage';

afterEach(() => cleanup());

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
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
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

  it('preserves the approved authentication branding panel content', () => {
    render(<MemoryRouter><CreateAccountPage /></MemoryRouter>);

    expect(screen.getByText(/Smart queueing/i)).toBeInTheDocument();
    expect(screen.getByText(/Better patient care/i)).toBeInTheDocument();
    expect(screen.getByText('Organize Appointments')).toBeInTheDocument();
    expect(screen.getByText('Real-time Queue')).toBeInTheDocument();
    expect(screen.getByText('Secure & Reliable')).toBeInTheDocument();
  });
});
