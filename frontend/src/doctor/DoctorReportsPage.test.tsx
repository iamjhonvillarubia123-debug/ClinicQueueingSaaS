import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DoctorReportsPage } from './DoctorReportsPage';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('Doctor Reports', () => {
  it('loads real clinic filter options while leaving unsupported range metrics unclaimed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([
      { id: 'clinic-1', lifecycleStatus: 'ACTIVE', name: 'Main Clinic', cityMunicipality: 'Davao City', province: 'Davao del Sur' },
      { id: 'clinic-2', lifecycleStatus: 'ACTIVE', name: 'Cebu Clinic', cityMunicipality: 'Cebu City', province: 'Cebu' },
    ]));
    render(<DoctorReportsPage />);
    expect(await screen.findByRole('option', { name: 'Main Clinic' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cebu Clinic' })).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/range reporting is not connected yet/i).length).toBeGreaterThan(0);
  });

  it('moves through Overview, Queue Performance, and Services without backend writes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([]));
    const user = userEvent.setup();
    render(<DoctorReportsPage />);
    await screen.findByRole('option', { name: 'All Clinics (0)' });
    await user.click(screen.getByRole('button', { name: 'Queue Performance' }));
    expect(screen.getByText('Average Queue Size by Hour')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Services' }));
    expect(screen.getByText('Services Summary')).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
});
