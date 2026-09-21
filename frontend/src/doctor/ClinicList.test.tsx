import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ClinicList, formatClinicShortCode } from './ClinicTab';

type Props = ComponentProps<typeof ClinicList>;
const draft = { name: 'Clinic', shortCode: 'MAIN', address: 'Davao City', country: 'Philippines', timeZone: 'Asia/Manila', contactNumber: '', email: '', description: '' };
const clinics: Props['clinics'] = Array.from({ length: 10 }, (_, index) => ({ ...draft, id: `clinic-${index}`, name: `Clinic ${index + 1}`, address: index === 9 ? 'Cagayan de Oro' : 'Davao City', status: index === 9 ? 'DRAFT' : 'ACTIVE', editor: { draft, hours: [], cutoffLeadHours: 2, services: [], questions: [] } }));
function setup() {
  const actions = { onAdd: vi.fn(), onOpen: vi.fn(), onEdit: vi.fn(), onActivate: vi.fn(), onDisable: vi.fn(), onDelete: vi.fn() };
  render(<ClinicList clinics={clinics} {...actions} />);
  return actions;
}

it('paginates clinics and searches location while resetting the page', async () => {
  const user = userEvent.setup();
  setup();
  expect(screen.getByText('Showing 1 to 8 of 10 clinics')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(screen.getByText('Showing 9 to 10 of 10 clinics')).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: 'Search clinics' }), 'Cagayan');
  expect(screen.getByText('Clinic 10')).toBeInTheDocument();
  expect(screen.getByText('Showing 1 to 1 of 1 clinics')).toBeInTheDocument();
  await user.clear(screen.getByRole('textbox', { name: 'Search clinics' }));
  await user.click(screen.getByRole('button', { name: 'Draft 1' }));
  expect(screen.queryByText('Clinic 1')).not.toBeInTheDocument();
  expect(screen.getByText('Clinic 10')).toBeInTheDocument();
});

it('hides and restores guidance and preserves selected clinic actions', async () => {
  const user = userEvent.setup();
  const actions = setup();
  await user.click(screen.getByRole('button', { name: 'Hide clinic guide' }));
  expect(screen.queryByRole('complementary', { name: 'Clinic list guide' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Show clinic guide/ }));
  expect(screen.getByRole('complementary', { name: 'Clinic list guide' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'More actions for Clinic 1' }));
  await user.click(screen.getByRole('menuitem', { name: /Edit Clinic/ }));
  await user.click(screen.getByRole('button', { name: 'Edit Clinic' }));
  expect(actions.onEdit).toHaveBeenCalledWith(clinics[0]);
});


it('uses saved clinic photos and short codes without a placeholder subtitle', () => {
  const photo = 'data:image/jpeg;base64,/9j/AA==';
  const actions = { onAdd: vi.fn(), onOpen: vi.fn(), onEdit: vi.fn(), onActivate: vi.fn(), onDisable: vi.fn(), onDelete: vi.fn() };
  const { rerender } = render(<ClinicList clinics={[{ ...clinics[0], clinicPhoto: photo, secretaryName: 'Maria Santos' }]} {...actions} />);
  expect(screen.getByRole('img', { name: 'Clinic 1 photo' })).toHaveAttribute('src', photo);
  expect(screen.getByText('Main')).toBeInTheDocument();
  expect(screen.getByText('Maria Santos')).toBeInTheDocument();
  rerender(<ClinicList clinics={[{ ...clinics[0], clinicPhoto: '', shortCode: '' }]} {...actions} />);
  expect(screen.getByRole('img', { name: 'Clinic 1 photo' }).getAttribute('src')).toContain('clinic-illustration');
  expect(screen.queryByText('Practice location')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Clinic branch name')).toHaveTextContent('--');
  expect(screen.getByText('Not assigned')).toBeInTheDocument();
});


it('formats branch-style short codes for saving', () => {
  expect(formatClinicShortCode('Bajada Branch')).toBe('BAJADA-BRANCH');
  expect(formatClinicShortCode('  Bajada   Branch  ')).toBe('BAJADA-BRANCH');
  expect(formatClinicShortCode('north_1')).toBe('NORTH_1');
});


it('shows saved hours and live clinic status without changing the action button', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ clinic: { doctorName: 'Dr. Santos' }, schedule: { isOpen: true, opensAt: '08:00', closesAt: '17:00' }, clinicDay: { status: 'STARTED' }, appointments: { total: 12 } }), { headers: { 'Content-Type': 'application/json' } }));
  try {
    render(<ClinicList clinics={[{ ...clinics[0], savedHours: [{ day: 'Mon', open: true, opens: '08:00 AM', closes: '05:00 PM', maximumUntil: '06:00 PM' }] }]} onAdd={vi.fn()} onOpen={vi.fn()} onEdit={vi.fn()} onActivate={vi.fn()} onDisable={vi.fn()} onDelete={vi.fn()} />);
    expect(await screen.findByText('12 appointments today')).toBeInTheDocument();
    expect(screen.getByText('Clinic: Open')).toBeInTheDocument();
    expect(screen.getByText('Today: 08:00 AM – 05:00 PM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Clinic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for Clinic 1' })).toBeInTheDocument();
  } finally { fetchMock.mockRestore(); }
});
