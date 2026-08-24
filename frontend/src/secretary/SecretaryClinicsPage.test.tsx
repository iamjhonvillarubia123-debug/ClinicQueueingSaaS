import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SecretaryClinicsPage } from './SecretaryClinicsPage';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function clinic(access: Record<string, unknown>) {
  return {
    id: 'clinic-1', lifecycleStatus: 'ACTIVE', name: 'North Clinic', addressLine1: 'Makati', addressLine2: null,
    cityMunicipality: 'Makati', province: 'Metro Manila', postalCode: null, contactNumber: null, timeZone: 'Asia/Manila',
    isBookingEnabled: true, latestSettingsDraft: null, settingsDrafts: [], access,
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Secretary assigned clinics access profile', () => {
  it('keeps Standard access operational-only', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([clinic({
      accessProfile: 'STANDARD', canManageClinicDetails: false, canManageServices: false,
      canManageBookingQuestions: false, canManageSchedules: false, capabilities: [],
    })])));
    render(<MemoryRouter><SecretaryClinicsPage /></MemoryRouter>);
    expect(await screen.findByText('North Clinic')).toBeInTheDocument();
    expect(screen.getByText('Standard access')).toBeInTheDocument();
    expect(screen.getByText('Operational workspace only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose configuration changes' })).not.toBeInTheDocument();
  });

  it('shows proposal entry when configuration access is granted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([clinic({
      accessProfile: 'CUSTOM', canManageClinicDetails: false, canManageServices: true,
      canManageBookingQuestions: false, canManageSchedules: false, capabilities: [],
    })])));
    render(<MemoryRouter><SecretaryClinicsPage /></MemoryRouter>);
    expect(await screen.findByText('North Clinic')).toBeInTheDocument();
    expect(screen.getByText('Custom access')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Propose configuration changes' })).toBeInTheDocument();
  });
});
