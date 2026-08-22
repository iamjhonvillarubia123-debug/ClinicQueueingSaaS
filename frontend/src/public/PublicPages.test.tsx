import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DoctorPublicPage, PracticeLocationPublicPage } from './PublicPages';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('F1 public pages', () => {
  it('renders the Doctor profile and stable PracticeLocation selection without private account data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      routeStatus: 'AVAILABLE',
      message: null,
      bookingEntryAllowed: true,
      doctor: {
        publicIdentifier: 'doctor-public-id', publicSlug: null, firstName: 'Mara', middleName: null, lastName: 'Santos', suffix: null,
        professionalTitle: 'Dr.', specialization: 'Pediatrics', profileDescription: 'Family-centered pediatric care.', profilePhotoUrl: null,
      },
      practiceLocations: [{
        publicIdentifier: 'clinic-public-id', publicUrl: 'http://localhost:5173/public/practice-locations/clinic-public-id',
        name: 'North Clinic', cityMunicipality: 'Quezon City', province: 'Metro Manila', bookingEntryAllowed: true,
      }],
    }));

    render(<MemoryRouter initialEntries={['/public/doctors/doctor-public-id']}><Routes><Route path="/public/doctors/:publicIdentifier" element={<DoctorPublicPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Dr. Mara Santos' })).toBeInTheDocument();
    expect(screen.getByText('Pediatrics')).toBeInTheDocument();
    expect(screen.getByText('North Clinic')).toBeInTheDocument();
    expect(screen.queryByText(/billing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/email/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View clinic' })).toHaveAttribute('href', '/public/practice-locations/clinic-public-id');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/public/doctors/doctor-public-id', expect.objectContaining({ credentials: 'include' }));
  });

  it('blocks booking on a temporarily unavailable PracticeLocation but keeps approved information visible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      routeStatus: 'TEMPORARILY_UNAVAILABLE',
      message: 'This practice location is currently unavailable. View other practice locations for this doctor.',
      bookingEntryAllowed: false,
      doctor: {
        publicIdentifier: 'doctor-public-id', publicSlug: null, firstName: 'Mara', middleName: null, lastName: 'Santos', suffix: null,
        professionalTitle: 'Dr.', specialization: 'Pediatrics', profileDescription: null, profilePhotoUrl: null,
      },
      practiceLocation: {
        name: 'North Clinic', addressLine1: '10 Main Street', addressLine2: null, cityMunicipality: 'Quezon City', province: 'Metro Manila',
        postalCode: '1100', countryCode: 'PH', timeZone: 'Asia/Manila',
      },
      services: [{ name: 'Consultation' }],
    }));

    render(<MemoryRouter initialEntries={['/public/practice-locations/clinic-public-id']}><Routes><Route path="/public/practice-locations/:publicIdentifier" element={<PracticeLocationPublicPage />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'North Clinic' })).toBeInTheDocument();
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    expect(screen.getByText(/currently unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue to booking' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View doctor and other locations/i })).toHaveAttribute('href', '/public/doctors/doctor-public-id');
  });

  it('renders a neutral retired-route state for a 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Public route not found.' }, 404));
    render(<MemoryRouter initialEntries={['/public/doctors/retired']}><Routes><Route path="/public/doctors/:publicIdentifier" element={<DoctorPublicPage />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'This public page is no longer available.' })).toBeInTheDocument());
  });
});
