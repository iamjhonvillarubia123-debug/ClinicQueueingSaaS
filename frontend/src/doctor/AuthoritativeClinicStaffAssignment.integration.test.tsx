import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoritativeClinicStaffTab } from './AuthoritativeClinicStaffTab';

const workspace = {
  clinic: { id: 'clinic-1', name: 'North Clinic' },
  staffAssignments: [],
  candidates: [
    {
      userId: 'secretary-1',
      name: 'Jane Reyes',
      email: 'jane@example.test',
      mobileNumber: '09183334444',
    },
  ],
  pendingInvitations: [],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('existing Secretary assignment API routing', () => {
  it('assigns an existing Clinic Secretary directly without creating an invitation', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes('/practice-location/clinic-1/staff')) {
        return jsonResponse(workspace);
      }
      if (url.includes('/practice-staff/regular/assign')) {
        return jsonResponse({ assigned: true, replayed: false });
      }
      return jsonResponse({ message: 'Unexpected request' }, 500);
    });
    const user = userEvent.setup();
    render(<AuthoritativeClinicStaffTab clinicId="clinic-1" />);

    await screen.findByRole('heading', { name: 'Staff' });
    await user.click(screen.getByRole('button', { name: /Assign Secretary/i }));
    await user.click(
      screen.getByRole('button', { name: /Assign Existing Secretary/i }),
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Assign Secretary' }));

    await waitFor(() =>
      expect(
        requests.some((request) =>
          request.url.includes('/practice-staff/regular/assign'),
        ),
      ).toBe(true),
    );
    expect(
      requests.some((request) =>
        request.url.includes('/practice-staff/invitations'),
      ),
    ).toBe(false);
    const direct = requests.find((request) =>
      request.url.includes('/practice-staff/regular/assign'),
    );
    expect(String(direct?.init?.body)).toContain('"userId":"secretary-1"');
    expect(String(direct?.init?.body)).toContain(
      '"authorityBundles":["QUEUE_AND_CLINIC_DAY_OPERATIONS"]',
    );
  });
});
