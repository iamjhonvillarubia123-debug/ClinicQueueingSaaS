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

const completedProfileState = {
  onboardingComplete: true,
  user: {
    firstName: doctor.firstName,
    middleName: doctor.middleName,
    lastName: doctor.lastName,
  },
  profile: {
    id: 'profile-1',
    middleName: doctor.middleName,
    suffix: doctor.suffix,
    professionalTitle: doctor.professionalTitle,
    specialization: doctor.specialization,
    licenseNumber: 'LIC-123',
    profileDescription: doctor.profileDescription,
    profilePhotoUrl: doctor.profilePhotoUrl,
    publicIdentifier: doctor.publicIdentifier,
    publicSlug: doctor.publicSlug,
    isProfilePublic: true,
  },
};

const incompleteProfileState = {
  onboardingComplete: false,
  user: {
    firstName: 'Jane',
    middleName: null,
    lastName: 'Doe',
  },
  profile: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Doctor Profile', () => {
  it('fills the approved profile UI from the authenticated profile and existing clinic/public-route reads', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.endsWith('/doctor/profile')) return response(completedProfileState);
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
    expect(screen.getByDisplayValue('LIC-123')).toHaveAttribute('readonly');
    expect(
      screen.getByDisplayValue('Patient-centered internal medicine care.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Dela Cruz Medical Clinic · Manila, Metro Manila/)).toBeInTheDocument();
    expect(screen.getByText('clinic@example.test')).toBeInTheDocument();
    expect(screen.getByText('+639171234567')).toBeInTheDocument();
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Preview Webpage' })[0]).toBeEnabled();
  });

  it('completes first-time Doctor onboarding without requiring a clinic to exist first', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const value = String(url);
      if (value.endsWith('/doctor/profile') && !options?.method) return response(incompleteProfileState);
      if (value.endsWith('/doctor/profile/onboarding') && options?.method === 'POST') {
        return response({
          onboardingComplete: true,
          user: { firstName: 'Jane', middleName: 'Q', lastName: 'Doe' },
          profile: {
            id: 'profile-new',
            middleName: 'Q',
            suffix: null,
            professionalTitle: 'Doctor',
            specialization: 'Family Medicine',
            licenseNumber: 'LIC-NEW',
            profileDescription: 'Community practice',
            profilePhotoUrl: null,
            publicIdentifier: 'doctor-public-new',
            publicSlug: null,
            isProfilePublic: false,
          },
        });
      }
      return response({}, 404);
    });

    const user = userEvent.setup();
    render(<DoctorProfilePage />);

    expect(await screen.findByDisplayValue('Jane')).toBeInTheDocument();
    expect(screen.getByText(/Complete the required professional information below/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Middle name'), 'Q');
    await user.type(screen.getByPlaceholderText('Doctor'), 'Doctor');
    await user.type(screen.getByPlaceholderText('Your area of medical practice'), 'Family Medicine');
    await user.type(screen.getByPlaceholderText('Professional license number'), 'LIC-NEW');
    await user.type(
      screen.getByPlaceholderText('Write a short professional description that patients can read on your public webpage.'),
      'Community practice',
    );
    await user.click(screen.getByRole('button', { name: 'Save Professional Profile' }));

    expect(await screen.findByText(/Professional profile saved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Professional Profile' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('LIC-NEW')).toHaveAttribute('readonly');

    const onboardingRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/doctor/profile/onboarding'));
    expect(onboardingRequest?.[1]?.method).toBe('POST');
    expect(String(onboardingRequest?.[1]?.body)).toContain('"licenseNumber":"LIC-NEW"');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/practice-location'))).toBe(false);
  });

  it('treats an authoritative doctor-route 404 as a private profile while retaining authenticated license data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.endsWith('/doctor/profile')) return response(completedProfileState);
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
    expect(screen.getByDisplayValue('LIC-123')).toHaveAttribute('readonly');
  });

  it('copies the backend-provided doctor public URL without creating a new API write', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const value = String(url);
      if (value.endsWith('/doctor/profile')) return response(completedProfileState);
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
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(<DoctorProfilePage />);
    await screen.findByText('https://example.test/public/doctors/doctor-public-1');
    await user.click(screen.getByRole('button', { name: 'Copy Link' }));

    expect(writeText).toHaveBeenCalledWith('https://example.test/public/doctors/doctor-public-1');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
});
