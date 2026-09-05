import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivateClinicDialog } from './ActivateClinicDialog';
import { apiRequest } from '../api/client';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn(),
}));

const apiRequestMock = vi.mocked(apiRequest);

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (path) => {
    if (path === '/doctor/account/data-privacy') {
      return {
        acknowledgementVersion: 'phase6-v6.1',
        currentAcknowledgementSatisfied: true,
      } as never;
    }
    if (path === '/practice-location/activate') {
      return { activated: true, replayed: false } as never;
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
});

describe('ActivateClinicDialog', () => {
  it('requires the current password', async () => {
    render(
      <ActivateClinicDialog
        practiceLocationId="location-1"
        onActivated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await screen.findByLabelText('Current password');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and Activate' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter your current password to activate this clinic.',
    );
  });

  it('records the retention acknowledgement before first clinic activation', async () => {
    apiRequestMock.mockImplementation(async (path) => {
      if (path === '/doctor/account/data-privacy') {
        return {
          acknowledgementVersion: 'phase6-v6.1',
          currentAcknowledgementSatisfied: false,
        } as never;
      }
      if (path === '/doctor/account/data-retention-acknowledgement') {
        return {
          acknowledged: true,
          acknowledgementVersion: 'phase6-v6.1',
        } as never;
      }
      if (path === '/practice-location/activate') {
        return { activated: true, replayed: false } as never;
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    const onActivated = vi.fn();
    render(
      <ActivateClinicDialog
        practiceLocationId="location-1"
        onActivated={onActivated}
        onCancel={vi.fn()}
      />,
    );

    const acknowledgement = await screen.findByRole('checkbox');
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and Activate' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Confirm the Data Retention Acknowledgement before activating this clinic.',
    );

    fireEvent.click(acknowledgement);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and Activate' }));

    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1));
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/doctor/account/data-retention-acknowledgement',
      {
        method: 'POST',
        body: { acknowledged: true },
      },
    );
    const acknowledgementCall = apiRequestMock.mock.calls.findIndex(
      ([path]) => path === '/doctor/account/data-retention-acknowledgement',
    );
    const activationCall = apiRequestMock.mock.calls.findIndex(
      ([path]) => path === '/practice-location/activate',
    );
    expect(acknowledgementCall).toBeGreaterThan(-1);
    expect(activationCall).toBeGreaterThan(acknowledgementCall);
  });

  it('sends a protected idempotent activation command when acknowledgement is already current', async () => {
    const onActivated = vi.fn();
    render(
      <ActivateClinicDialog
        practiceLocationId="location-1"
        onActivated={onActivated}
        onCancel={vi.fn()}
      />,
    );

    await screen.findByLabelText('Current password');
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and Activate' }));

    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1));
    expect(apiRequestMock).toHaveBeenCalledWith(
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
    expect(
      apiRequestMock.mock.calls.some(
        ([path]) => path === '/doctor/account/data-retention-acknowledgement',
      ),
    ).toBe(false);
  });
});
