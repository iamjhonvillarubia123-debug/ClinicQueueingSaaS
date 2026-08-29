import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClinicOperationsWorkspace } from './ClinicOperationsWorkspace';

afterEach(cleanup);

function renderWorkspace(onEvent = vi.fn()) {
  render(
    <ClinicOperationsWorkspace
      clinic={{ name: 'North Clinic', address: 'Davao City', timeZone: 'Asia/Manila' }}
      onBack={vi.fn()}
      onEvent={onEvent}
    />,
  );
  return onEvent;
}

describe('ClinicOperationsWorkspace', () => {
  it('moves through every approved clinic operations tab', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    expect(screen.getByText("Today’s Queue")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Queue' }));
    expect(screen.getByText(/WAITING LIST/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Appointments' }));
    expect(screen.getByText('Appointment Summary')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Staff' }));
    expect(screen.getByText('Manage the secretaries assigned to North Clinic.')).toBeInTheDocument();
  });

  it('exposes connect-ready queue events while updating the local preview', async () => {
    const user = userEvent.setup();
    const onEvent = renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Queue' }));
    await user.click(screen.getByRole('button', { name: '▷ CALL NEXT' }));

    expect(onEvent).toHaveBeenCalledWith({ type: 'CALL_NEXT', patientId: 7 });
    expect(screen.getByRole('status')).toHaveTextContent('The next patient is now being served.');
  });

  it('opens each approved queue action drawer', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole('button', { name: 'Queue' }));

    await user.click(screen.getByRole('button', { name: /ADD WALK-IN/ }));
    expect(screen.getByRole('heading', { name: 'Add Walk-in' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close Add Walk-in' }));

    await user.click(screen.getByRole('button', { name: /ADJUST QUEUE/ }));
    expect(screen.getByText('What do you want to do?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close Adjust Queue' }));

    await user.click(screen.getByRole('button', { name: /DELAY \/ BREAK/ }));
    expect(screen.getByText('Pause patient serving')).toBeInTheDocument();
  });
});
