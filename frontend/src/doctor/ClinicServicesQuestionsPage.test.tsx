import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ClinicServicesQuestionsPage } from './ClinicServicesQuestionsPage';

function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ClinicServicesQuestionsPage', () => {
  it('shows an effective service created through approved Secretary settings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ services: [{ id: 'service-1', name: 'Acceptance Test Service', durationMinutes: 15, status: 'ACTIVE' }], bookingQuestions: [] }));
    render(<MemoryRouter initialEntries={['/app/practice-locations/location-1/services-questions']}><Routes><Route path="/app/practice-locations/:practiceLocationId/services-questions" element={<ClinicServicesQuestionsPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Acceptance Test Service')).toBeInTheDocument();
    expect(screen.getByText(/15 minutes · ACTIVE/)).toBeInTheDocument();
  });

  it('creates a Doctor-owned clinic service and reloads effective configuration', async () => {
    let reads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/services')) return response({ id: 'service-2' });
      reads += 1;
      return response({ services: reads > 1 ? [{ id: 'service-2', name: 'Follow-up', durationMinutes: 20, status: 'ACTIVE' }] : [], bookingQuestions: [] });
    });
    render(<MemoryRouter initialEntries={['/app/practice-locations/location-1/services-questions']}><Routes><Route path="/app/practice-locations/:practiceLocationId/services-questions" element={<ClinicServicesQuestionsPage />} /></Routes></MemoryRouter>);
    await screen.findByText('No clinic services configured yet.');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Follow-up' } });
    fireEvent.change(screen.getByLabelText('Duration minutes'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/services'))).toBe(true));
    expect(await screen.findByText('Follow-up')).toBeInTheDocument();
  });
});
