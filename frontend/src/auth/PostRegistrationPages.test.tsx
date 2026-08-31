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

  it('shows the Doctor account-ready state and Doctor onboarding destination', () => {
    render(<MemoryRouter initialEntries={['/registration/account-ready?role=DOCTOR']}><RegistrationAccountReadyPage /></MemoryRouter>);

    expect(screen.getByText('Your Doctor account has been verified.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/registration/doctor-onboarding');
  });

  it('shows the Secretary account-ready state and Secretary empty-home destination', () => {
    render(<MemoryRouter initialEntries={['/registration/account-ready?role=SECRETARY']}><RegistrationAccountReadyPage /></MemoryRouter>);

    expect(screen.getByText('Your Secretary account has been verified.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/registration/secretary-home');
  });

  it('routes Doctor setup into the protected Doctor Settings tab', () => {
    render(<MemoryRouter><DoctorOnboardingPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: "Let's get you started" })).toBeInTheDocument();
    expect(screen.getByText('Complete your profile')).toBeInTheDocument();
    expect(screen.getByText('Create your clinic')).toBeInTheDocument();
    expect(screen.getByText('Configure settings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start setup' })).toHaveAttribute('href', '/app/settings');
  });

  it('routes a zero-assignment Secretary into the protected Secretary Settings tab', () => {
    render(<MemoryRouter><SecretaryNoAssignmentsPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: /Welcome to Clinic Queueing/i })).toBeInTheDocument();
    expect(screen.getByText('No clinic assignments yet')).toBeInTheDocument();
    expect(screen.getByText(/Clinics will appear here when a Doctor assigns you as a Secretary/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create clinic/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to settings' })).toHaveAttribute('href', '/app/secretary/settings');
  });
});
