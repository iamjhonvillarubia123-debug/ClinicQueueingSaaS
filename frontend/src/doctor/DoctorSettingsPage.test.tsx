import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoctorSettingsPage } from './DoctorSettingsPage';

const refresh = vi.fn().mockResolvedValue(undefined);
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    profile: { userId: 'doctor-test', role: 'DOCTOR' },
    refresh,
  }),
}));
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function mount(tab = 'account') {
  render(
    <MemoryRouter initialEntries={[`/app/settings?tab=${tab}`]}>
      <DoctorSettingsPage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
});

describe('Doctor Settings', () => {
  it('shows all five sections without inventing account data and safely blocks disablement', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => response({ sessions: [] }));
    const user = mount();
    for (const name of [
      'Account & Security',
      'Doctor Defaults',
      'Notifications',
      'Data & Privacy',
      'Audit Log',
    ])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByText('Dr. Juan Dela Cruz')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disable Account' }));
    const dialog = screen.getByRole('dialog', { name: 'Disable Account' });
    expect(
      within(dialog).getByRole('button', {
        name: 'Disable Account',
      }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText(/does not verify the password/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
  });

  it('leaves password change unconnected and requires a password for other-session revocation', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        response({
          sessions: [
            {
              id: 'other',
              isCurrent: false,
              createdAt: '2026-09-03T09:00:00Z',
              lastSeenAt: '2026-09-03T09:00:00Z',
              expiresAt: '2026-09-04T09:00:00Z',
            },
          ],
        }),
      );
    const user = mount();
    await user.click(
      screen.getAllByRole('button', {
        name: 'Change Password',
      })[0],
    );
    expect(
      screen.getByRole('button', { name: 'Update Password' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(
      screen.getAllByRole('button', {
        name: 'Sign Out All Other Sessions',
      })[0],
    );
    expect(
      screen.getByRole('button', { name: 'Sign Out Others' }),
    ).toBeDisabled();
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
  });

  it('requires explicit final confirmation and preserves the form on deletion failure', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        String(url).endsWith('/auth/sessions')
          ? response({ sessions: [] })
          : response(
              { message: 'Email or current password is incorrect.' },
              401,
            ),
      );
    const user = mount();
    await user.click(
      screen.getByRole('button', { name: 'Delete Account Permanently' }),
    );
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByRole('button', { name: 'Permanently Delete My Account' }),
    ).toBeDisabled();
    await user.type(
      screen.getByLabelText('Doctor account email'),
      'test@example.test',
    );
    await user.type(
      screen.getByLabelText('Password', { exact: true }),
      'test-password',
    );
    await user.click(screen.getByRole('checkbox'));
    await user.click(
      screen.getByRole('button', { name: 'Permanently Delete My Account' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect');
    const [url, options] = fetchMock.mock.calls.find(
      ([, options]) => options?.method === 'POST',
    )!;
    expect(String(url)).toContain('/doctor/account/permanent-delete');
    expect(JSON.parse(String(options?.body))).toEqual({
      email: 'test@example.test',
      password: 'test-password',
      confirmPermanentDelete: true,
    });
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('loads defaults and sends valid service creates and updates', async () => {
    const defaults = {
      services: [
        {
          id: 'service-1',
          name: 'Consultation',
          durationMinutes: 20,
          status: 'ACTIVE',
        },
      ],
      bookingQuestions: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_, options) =>
        response(options?.method ? {} : defaults),
      );
    const user = mount('defaults');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Manage Services' }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Manage Services' }));
    let dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Duration (minutes)'));
    await user.type(screen.getByLabelText('Duration (minutes)'), '25');
    await user.click(screen.getByRole('button', { name: 'Save Service' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Template saved',
    );
    const update = fetchMock.mock.calls.find(
      ([url, options]) =>
        String(url).endsWith('/services/service-1') &&
        options?.method === 'PATCH',
    );
    expect(JSON.parse(String(update?.[1]?.body))).toEqual({
      name: 'Consultation',
      durationMinutes: 25,
      status: 'ACTIVE',
    });
    dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: '+ Add Service' }),
    );
    await user.type(screen.getByLabelText('Service name'), 'Follow-up');
    await user.click(screen.getByRole('button', { name: 'Save Service' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith('/services') && options?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('creates booking questions using the existing contract', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        response({ services: [], bookingQuestions: [] }),
      );
    const user = mount('defaults');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Manage Booking Questions' }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole('button', { name: 'Manage Booking Questions' }),
    );
    await user.click(screen.getByRole('button', { name: '+ Add Question' }));
    await user.type(
      screen.getByLabelText('Question', { exact: true }),
      'Reason for visit?',
    );
    await user.click(screen.getByLabelText('Required', { exact: true }));
    await user.click(screen.getByRole('button', { name: 'Save Question' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Template saved',
    );
    const call = fetchMock.mock.calls.find(
      ([, options]) => options?.method === 'POST',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      questionText: 'Reason for visit?',
      type: 'TEXT',
      isRequired: true,
      displayOrder: 0,
      isActive: true,
    });
  });

  it('converts serialized decimal question limits back to numeric API values', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        response({
          services: [],
          bookingQuestions: [
            {
              id: 'question-1',
              questionText: 'How many?',
              type: 'NUMBER',
              isRequired: false,
              isActive: true,
              displayOrder: 0,
              numberMinimum: '1.5',
              numberMaximum: '10.5',
            },
          ],
        }),
      );
    const user = mount('defaults');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Manage Booking Questions' }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole('button', { name: 'Manage Booking Questions' }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Edit' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save Question' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Template saved',
    );
    const call = fetchMock.mock.calls.find(
      ([, options]) => options?.method === 'PATCH',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      numberMinimum: 1.5,
      numberMaximum: 10.5,
    });
  });

  it('requires templates before copying and loads current general defaults', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        response(
          String(url).endsWith('/practice-location')
            ? [
                {
                  id: 'clinic-1',
                  name: 'Test Clinic',
                  lifecycleStatus: 'ACTIVE',
                },
              ]
            : String(url).endsWith('/account/settings')
              ? {
                  defaultTimeZone: 'Asia/Manila',
                  maximumAdvanceBookingDays: 30,
                  allowOnlineBooking: true,
                }
              : { services: [], bookingQuestions: [] },
        ),
      );
    const user = mount('defaults');
    await user.click(
      screen.getAllByRole('button', { name: 'Apply to Clinics' })[0],
    );
    await user.click(
      await screen.findByRole('checkbox', { name: 'Test Clinic' }),
    );
    expect(screen.getByRole('button', { name: 'Review Copy' })).toBeDisabled();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Close',
      }),
    );
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
    expect(screen.getByLabelText('Select Timezone')).toHaveValue('Asia/Manila');
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
  });

  it('marks all unread notifications with existing per-notification endpoints', async () => {
    const items = [1, 2].map((id) => ({
      id: `notice-${id}`,
      notificationType: 'SECRETARY_ACCOUNT_DISABLED',
      affectedSecretaryUserId: 'secretary-1',
      practiceLocationId: 'clinic-1',
      createdAt: '2026-09-03T09:00:00Z',
      readAt: null,
    }));
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url, options) => {
        if (options?.method === 'PATCH')
          return response({
            ...items.find((item) => String(url).includes(item.id)),
            readAt: '2026-09-03T10:00:00Z',
          });
        return response(
          String(url).endsWith('/practice-location')
            ? [{ id: 'clinic-1', name: 'Test Clinic' }]
            : items,
        );
      });
    const user = mount('notifications');
    expect(
      await screen.findByRole('button', { name: 'Unread (2)' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark All as Read' }));
    expect(
      await screen.findByRole('button', { name: 'Unread (0)' }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'PATCH'),
    ).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Unread (0)' }));
    expect(screen.getByText('You’re all caught up')).toBeInTheDocument();
  });

  it('reports partial notification failures without falsely marking all as read', async () => {
    const items = [1, 2].map((id) => ({
      id: `notice-${id}`,
      notificationType: 'SECRETARY_ACCOUNT_DELETED',
      practiceLocationId: 'clinic-1',
      createdAt: '2026-09-03T09:00:00Z',
      readAt: null,
    }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (options?.method === 'PATCH')
        return String(url).includes('notice-1')
          ? response({ ...items[0], readAt: '2026-09-03T10:00:00Z' })
          : response({ message: 'Failed' }, 500);
      return response(String(url).endsWith('/practice-location') ? [] : items);
    });
    const user = mount('notifications');
    await screen.findByRole('button', { name: 'Unread (2)' });
    await user.click(screen.getByRole('button', { name: 'Mark All as Read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some notifications',
    );
    expect(
      screen.getByRole('button', { name: 'Unread (1)' }),
    ).toBeInTheDocument();
  });

  it('records acknowledgment only after explicit agreement and displays real policy values', async () => {
    const policy = {
      acknowledgementVersion: 'phase6-v6.1',
      terminalAppointmentIdentifiableRetentionHours: 24,
      permanentlyClosedAccountMinimizationDays: 7,
      currentAcknowledgementSatisfied: false,
      acknowledgedAt: null,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(policy));
    const user = mount('privacy');
    await screen.findByText('phase6-v6.1');
    await user.click(
      screen.getByRole('button', { name: 'Review & Acknowledge' }),
    );
    expect(
      screen.getByRole('button', { name: 'Acknowledge Policy' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValue(
      response({
        ...policy,
        currentAcknowledgementSatisfied: true,
        acknowledgedAt: '2026-09-03T09:00:00Z',
      }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Acknowledge Policy' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    const call = fetchMock.mock.calls.find(
      ([, options]) => options?.method === 'POST',
    );
    expect(String(call?.[0])).toContain(
      '/doctor/account/data-retention-acknowledgement',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ acknowledged: true });
  });

  it('shows an honest audit placeholder and no invented totals', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    mount('audit');
    expect(
      screen.getByText('Audit history is not connected yet'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles retained notifications without a clinic reference', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      response(
        String(url).endsWith('/practice-location')
          ? []
          : [
              {
                id: 'notice-1',
                notificationType: 'SECRETARY_ACCOUNT_DELETED',
                practiceLocationId: null,
                affectedSecretaryUserId: null,
                createdAt: '2026-09-03T09:00:00Z',
                readAt: null,
              },
            ],
      ),
    );
    const user = mount('notifications');
    await user.click(
      await screen.findByRole('button', { name: 'View Details' }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'View Clinic' }),
    ).not.toBeInTheDocument();
  });

  it('offers retry when backend data cannot load', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('offline'));
    const user = mount('defaults');
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent(
      'Unable to load',
    );
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    fetchMock.mockImplementation(async (url) => response(String(url).endsWith('/account/settings')
      ? { defaultTimeZone: 'Asia/Manila', maximumAdvanceBookingDays: 30, allowOnlineBooking: true }
      : { services: [], bookingQuestions: [] }));
    for (const button of screen.getAllByRole('button', { name: 'Retry' }))
      await user.click(button);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Manage Services' }),
      ).toBeEnabled(),
    );
  });
});
