import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import {
  DoctorOnboardingPage,
  RegistrationAccountReadyPage,
  RegistrationCheckEmailPage,
  SecretaryNoAssignmentsPage,
} from './PostRegistrationPages';

afterEach(() => cleanup());

describe('approved post-registration UI states', () => {
  it('shows the shared email-verification state', () => {
    render(<MemoryRouter initialEntries={['/registration/check-email?email=doctor%40example.com&role=DOCTOR']}><RegistrationCheckEmailPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    expect(screen.getByText('doctor@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go back' })).toHaveAttribute('href', '/register');
  });

  it('routes a verified Doctor directly to the Doctor Profile tab', () => {
    render(<MemoryRouter initialEntries={['/registration/account-ready?role=DOCTOR']}><RegistrationAccountReadyPage /></MemoryRouter>);

    expect(screen.getByText('Your Doctor account has been verified.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/app/profile');
  });

  it('routes a verified Secretary directly to the Secretary Profile tab', () => {
    render(<MemoryRouter initialEntries={['/registration/account-ready?role=SECRETARY']}><RegistrationAccountReadyPage /></MemoryRouter>);

    expect(screen.getByText('Your Secretary account has been verified.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/app/secretary/profile');
  });

  it('keeps the legacy Doctor onboarding page pointed at the Doctor Profile tab', () => {
    render(<MemoryRouter><DoctorOnboardingPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: "Let's get you started" })).toBeInTheDocument();
    expect(screen.getByText('Complete your profile')).toBeInTheDocument();
    expect(screen.getByText('Create your clinic')).toBeInTheDocument();
    expect(screen.getByText('Configure settings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start setup' })).toHaveAttribute('href', '/app/profile');
  });

  it('keeps the zero-assignment Secretary page pointed at the Secretary Profile tab', () => {
    render(<MemoryRouter><SecretaryNoAssignmentsPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: /Welcome to Clinic Queueing/i })).toBeInTheDocument();
    expect(screen.getByText('No clinic assignments yet')).toBeInTheDocument();
    expect(screen.getByText(/Clinics will appear here when a Doctor assigns you as a Secretary/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create clinic/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to profile' })).toHaveAttribute('href', '/app/secretary/profile');
  });
});
