import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { PermanentlyDeleteClinicDialog } from './PermanentlyDeleteClinicDialog';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PermanentlyDeleteClinicDialog', () => {
  it('requires permanent-delete confirmation before submitting', async () => {
    render(
      <PermanentlyDeleteClinicDialog
        practiceLocationId="location-1"
        clinicName="Clinic A"
        onDeleted={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Permanently Delete Clinic' }),
    );

    expect(
      await screen.findByText(
        'Confirm that you understand this clinic deletion is permanent.',
      ),
    ).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('sends the protected permanent-delete command with idempotency', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      permanentlyDeleted: true,
      replayed: false,
    });
    const onDeleted = vi.fn();

    render(
      <PermanentlyDeleteClinicDialog
        practiceLocationId="location-1"
        clinicName="Clinic A"
        onDeleted={onDeleted}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByLabelText(
        'I understand that this clinic deletion is permanent.',
      ),
    );
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Permanently Delete Clinic' }),
    );

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenCalledWith(
      '/practice-location/permanent-delete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
        }),
        body: {
          practiceLocationId: 'location-1',
          password: 'current-password',
          confirmPermanentDelete: true,
        },
      }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });
});
