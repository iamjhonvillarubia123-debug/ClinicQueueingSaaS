import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SecretaryClinicsPage } from './SecretaryClinicsPage';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function clinic(access: Record<string, unknown>, latestSettingsDraft: Record<string, unknown> | null = null) {
  return {
    id: 'clinic-1', lifecycleStatus: 'ACTIVE', name: 'North Clinic', addressLine1: 'Makati', addressLine2: null,
    cityMunicipality: 'Makati', province: 'Metro Manila', postalCode: null, contactNumber: null, timeZone: 'Asia/Manila',
    isBookingEnabled: true, latestSettingsDraft, settingsDrafts: latestSettingsDraft ? [latestSettingsDraft] : [], access,
  };
}

const fullAccess = {
  accessProfile: 'FULL_CLINIC_CONFIGURATION', canManageClinicDetails: true, canManageServices: true,
  canManageBookingQuestions: true, canManageSchedules: true, capabilities: [],
};

function draft(status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_REWORK') {
  return {
    id: 'draft-1', status, submittedAt: status === 'DRAFT' ? null : '2026-08-24T01:00:00.000Z',
    reviewedAt: status === 'APPROVED' || status === 'REJECTED' ? '2026-08-24T02:00:00.000Z' : null,
    reviewComment: null, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T02:00:00.000Z',
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
    expect(screen.queryByRole('button', { name: 'Propose changes' })).not.toBeInTheDocument();
  });

  it('shows one concise proposal action when configuration access is granted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([clinic({
      accessProfile: 'CUSTOM', canManageClinicDetails: false, canManageServices: true,
      canManageBookingQuestions: false, canManageSchedules: false, capabilities: [],
    })])));
    render(<MemoryRouter><SecretaryClinicsPage /></MemoryRouter>);
    expect(await screen.findByText('North Clinic')).toBeInTheDocument();
    expect(screen.getByText('Custom access')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Propose changes' })).toBeInTheDocument();
  });

  it('allows a new proposal after approval without showing closed-draft clutter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([clinic(fullAccess, draft('APPROVED'))])));
    render(<MemoryRouter><SecretaryClinicsPage /></MemoryRouter>);
    expect(await screen.findByText('North Clinic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Propose changes' })).toBeInTheDocument();
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /closed draft/i })).not.toBeInTheDocument();
  });

  it('shows only the pending proposal action during Doctor review', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([clinic(fullAccess, draft('SUBMITTED'))])));
    render(<MemoryRouter><SecretaryClinicsPage /></MemoryRouter>);
    expect(await screen.findByText('North Clinic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View pending proposal' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose changes' })).not.toBeInTheDocument();
  });
});
