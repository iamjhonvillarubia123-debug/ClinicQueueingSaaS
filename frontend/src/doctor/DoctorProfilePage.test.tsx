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
    email: 'personal@example.test',
    mobileNumber: '+639171234567',
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
    expect(screen.getByText('1 active clinic')).toBeInTheDocument();
    expect(screen.getByText('personal@example.test')).toBeInTheDocument();
    expect(screen.getByText('+639171234567')).toBeInTheDocument();
    expect(screen.getAllByText('Public').length).toBeGreaterThan(0);
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
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/practice-location'))).toBe(true);
  });

  it('keeps unpublished profiles private and publishes only inside the blank preview', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/presentation')) return response(completedProfileState);
      if (String(url).endsWith('/doctor/profile')) return response({ ...completedProfileState, profile: { ...completedProfileState.profile, isProfilePublic: false } });
      if (String(url).endsWith('/practice-location')) return response([clinic]);
      return response({}, 404);
    });
    render(<DoctorProfilePage />);
    await screen.findAllByText('Private');
    await user.click(screen.getAllByRole('button', { name: 'Preview Webpage' })[0]);
    expect(screen.getByLabelText('Blank webpage preview')).toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: 'Publish Webpage' }));
    expect(await screen.findByRole('button', { name: 'Unpublish Webpage' })).toBeEnabled();
    expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/presentation'))?.[1]?.body).toBe(JSON.stringify({ isProfilePublic: true }));
    await user.click(screen.getByRole('button', { name: 'Back to Profile' }));
    expect(screen.getAllByText('Public').length).toBeGreaterThan(0);
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
    await screen.findByText(`${window.location.origin}/public/doctors/doctor-public-1`);
    await user.click(screen.getByRole('button', { name: 'Copy Link' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/public/doctors/doctor-public-1`);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
});


it('saves zoom and restores it in the photo frame', async () => {
  const user = userEvent.setup();
  const initial = { ...completedProfileState, profile: { ...completedProfileState.profile, profilePhotoUrl: 'data:image/jpeg;base64,/9j/AA==', profilePhotoZoom: 1, profilePhotoX: 50, profilePhotoY: 60 } };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    if (String(url).endsWith('/presentation')) return response({ ...initial, profile: { ...initial.profile, ...JSON.parse(String(options?.body)) } });
    if (String(url).endsWith('/doctor/profile')) return response(initial);
    return response([]);
  });
  render(<DoctorProfilePage />);
  const zoomIn = await screen.findByRole('button', { name: 'Zoom in photo' });
  expect(screen.getByRole('button', { name: 'Zoom out photo' })).toBeDisabled();
  await user.click(zoomIn);
  expect(await screen.findByText('120%')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Drag to reposition/ })).toHaveStyle({ transform: 'scale(1.2)', transformOrigin: '50% 60%' });
  expect(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/presentation'))?.[1]?.body).toBe('{"profilePhotoZoom":1.2}');
});
