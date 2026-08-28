import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApplyClinicChangesDialog } from './ApplyClinicChangesDialog';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn().mockResolvedValue({ applied: true, replayed: false }),
}));

import { apiRequest } from '../api/client';

describe('ApplyClinicChangesDialog', () => {
  it('requires the current password and sends one protected apply command', async () => {
    const onApplied = vi.fn();
    render(
      <ApplyClinicChangesDialog
        practiceLocationId="location-1"
        onApplied={onApplied}
        onCancel={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and Apply' }));
    expect(
      screen.getByText(
        'Enter your current password to apply these clinic changes.',
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'secret-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and Apply' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    expect(apiRequest).toHaveBeenCalledWith(
      '/practice-location/apply-configuration-draft',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
        }),
        body: {
          practiceLocationId: 'location-1',
          password: 'secret-password',
          confirmApply: true,
        },
      }),
    );
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});
