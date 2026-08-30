import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { DisableClinicDialog } from './DisableClinicDialog';

vi.mock('../api/client', () => ({ apiRequest: vi.fn() }));

describe('DisableClinicDialog', () => {
  it('requires the Doctor current password', async () => {
    render(
      <DisableClinicDialog
        practiceLocationId="location-1"
        onDisabled={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm and Disable' }),
    );

    expect(
      await screen.findByText(
        'Enter your current password to disable this clinic.',
      ),
    ).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('sends the protected disable command with one idempotency key', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      disabled: true,
      replayed: false,
    });
    const onDisabled = vi.fn();

    render(
      <DisableClinicDialog
        practiceLocationId="location-1"
        onDisabled={onDisabled}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'doctor-password' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm and Disable' }),
    );

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    const [, options] = vi.mocked(apiRequest).mock.calls[0];
    expect(apiRequest).toHaveBeenCalledWith('/practice-location/disable', {
      method: 'POST',
      headers: { 'Idempotency-Key': expect.any(String) },
      body: {
        practiceLocationId: 'location-1',
        password: 'doctor-password',
        confirmDisable: true,
      },
    });
    const headers = options?.headers as Record<string, string> | undefined;
    expect(headers?.['Idempotency-Key']).toBeTruthy();
    await waitFor(() => expect(onDisabled).toHaveBeenCalledTimes(1));
  });
});
