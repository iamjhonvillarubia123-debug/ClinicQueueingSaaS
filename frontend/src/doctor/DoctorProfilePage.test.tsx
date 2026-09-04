import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DoctorProfilePage } from './DoctorProfilePage';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const clinic = {
  id: 'clinic-1',
  publicIdentifier: 'clinic-public-1',
  lifecycleStatus: 'ACTIVE',
  name: 'Dela Cruz Medical Clinic',
  addressLine1: '123 Main Street',
  cityMunicipality: 'Manila',
  province: 'Metro Manila',
  contactNumber: '+639171234567',
  clinicEmail: 'clinic@example.test',
  services: [],
};

const doctor = {
  publicIdentifier: 'doctor-public-1',
  publicSlug: 'juan-dela-cruz',
  firstName: 'Juan',
  middleName: 'Santos',
  lastName: 'Dela Cruz',
  suffix: null,
  professionalTitle: 'Dr.',
  specialization: 'Internal Medicine',
  profileDescription: 'Patient-centered internal medicine care.',
  profilePhotoUrl: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Doctor Profile', () => {
  it('fills the approved profile UI from existing clinic and public-route reads', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.endsWith('/practice-location')) return response([clinic]);
      if (value.includes('/public/practice-locations/clinic-public-1')) {
        return response({
          publicIdentifier: clinic.publicIdentifier,
          publicUrl: 'https://example.test/public/practice-locations/clinic-public-1',
          qrPayload: 'https://example.test/public/practice-locations/clinic-public-1',
          doctorPublicUrl: 'https://example.test/public/doctors/doctor-public-1',
          doctor,
        });
      }
      if (value.includes('/public/doctors/doctor-public-1')) {
        return response({
          publicIdentifier: doctor.publicIdentifier,
          publicSlug: doctor.publicSlug,
          publicUrl: 'https://example.test/public/doctors/doctor-public-1',
          qrPayload: 'https://example.test/public/doctors/doctor-public-1',
          doctor,
        });
      }
      return response({}, 404);
    });

    render(<DoctorProfilePage />);

    expect(await screen.findByDisplayValue('Juan')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Santos')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dela Cruz')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dr.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Internal Medicine')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('Patient-centered internal medicine care.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Dela Cruz Medical Clinic · Manila, Metro Manila/)).toBeInTheDocument();
    expect(screen.getByText('clinic@example.test')).toBeInTheDocument();
    expect(screen.getByText('+639171234567')).toBeInTheDocument();
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Preview Webpage' })[0]).toBeEnabled();
  });

  it('treats an authoritative doctor-route 404 as a private profile and does not invent license data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.endsWith('/practice-location')) return response([clinic]);
      if (value.includes('/public/practice-locations/clinic-public-1')) {
        return response({
          publicIdentifier: clinic.publicIdentifier,
          publicUrl: 'https://example.test/public/practice-locations/clinic-public-1',
          qrPayload: 'https://example.test/public/practice-locations/clinic-public-1',
          doctorPublicUrl: 'https://example.test/public/doctors/doctor-public-1',
          doctor,
        });
      }
      if (value.includes('/public/doctors/doctor-public-1')) return response({ message: 'Not found' }, 404);
      return response({}, 404);
    });

    render(<DoctorProfilePage />);

    expect((await screen.findAllByText('Private')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Preview Webpage' })[0]).toBeDisabled();
    expect(screen.getByPlaceholderText('Professional license number')).toHaveValue('');
    expect(screen.getByText(/current authenticated profile API does not expose it/i)).toBeInTheDocument();
  });

  it('copies the backend-provided doctor public URL without creating a new API write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.endsWith('/practice-location')) return response([clinic]);
      if (value.includes('/public/practice-locations/clinic-public-1')) {
        return response({
          publicIdentifier: clinic.publicIdentifier,
          publicUrl: 'https://example.test/public/practice-locations/clinic-public-1',
          qrPayload: 'https://example.test/public/practice-locations/clinic-public-1',
          doctorPublicUrl: 'https://example.test/public/doctors/doctor-public-1',
          doctor,
        });
      }
      if (value.includes('/public/doctors/doctor-public-1')) return response({ message: 'Not found' }, 404);
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<DoctorProfilePage />);
    await screen.findByText('https://example.test/public/doctors/doctor-public-1');
    await user.click(screen.getByRole('button', { name: 'Copy Link' }));

    expect(writeText).toHaveBeenCalledWith('https://example.test/public/doctors/doctor-public-1');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
});
