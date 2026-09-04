import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DoctorBillingPage } from './DoctorBillingPage';

describe('Doctor Billing', () => {
  it('renders the approved billing workspace without inventing authoritative financial values', () => {
    render(<DoctorBillingPage />);
    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(screen.getByText('Current Plan')).toBeInTheDocument();
    expect(screen.getByText('Available Credit')).toBeInTheDocument();
    expect(screen.getByText('Subscription Status')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/not exposed by a current Doctor billing API yet/i)).toBeInTheDocument();
  });

  it('opens approved detail surfaces without making backend writes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    render(<DoctorBillingPage />);
    await user.click(screen.getByRole('button', { name: 'View Plan Details' }));
    expect(screen.getByRole('dialog', { name: 'View Plan Details' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Manage Subscription' }));
    expect(screen.getByRole('dialog', { name: 'Manage Subscription' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
