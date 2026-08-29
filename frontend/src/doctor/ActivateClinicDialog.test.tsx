import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivateClinicDialog } from './ActivateClinicDialog';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn().mockResolvedValue({ activated: true, replayed: false }),
}));

import { apiRequest } from '../api/client';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ActivateClinicDialog', () => {
  it('requires the current password', () => {
    render(
      <ActivateClinicDialog
        practiceLocationId="location-1"
        onActivated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and Activate' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter your current password to activate this clinic.',
    );
  });

  it('sends a protected idempotent activation command', async () => {
    const onActivated = vi.fn();
    render(
      <ActivateClinicDialog
        practiceLocationId="location-1"
        onActivated={onActivated}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and Activate' }));

    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenCalledWith(
      '/practice-location/activate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
        }),
        body: {
          practiceLocationId: 'location-1',
          password: 'current-password',
          confirmActivation: true,
        },
      }),
    );
  });
});
