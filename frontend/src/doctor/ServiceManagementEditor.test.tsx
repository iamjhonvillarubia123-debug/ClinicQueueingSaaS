import { useState, type ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { ServiceManagementEditor } from './ServiceManagementEditor';

vi.mock('../api/client', () => ({ apiRequest: vi.fn() }));
const initial = [{ id: 'original', name: 'Consultation', description: 'General consultation', minutes: 30, active: true }];
function Harness() {
  const [services, setServices] = useState<ComponentProps<typeof ServiceManagementEditor>['services']>(initial);
  return <ServiceManagementEditor services={services} setServices={setServices} />;
}
beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

it('discards cancelled additions and edits, and saves a valid inactive service', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: '+ Add Service' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Services (1)')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit service Consultation' }));
  await user.clear(screen.getByLabelText('Service name for Consultation'));
  await user.type(screen.getByLabelText('Service name for'), 'Changed');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Consultation')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '+ Add Service' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Service name for'), 'Follow-up');
  await user.selectOptions(dialog.getByLabelText('Status for Follow-up'), 'INACTIVE');
  await user.clear(dialog.getByLabelText('Duration for Follow-up'));
  await user.type(dialog.getByLabelText('Duration for Follow-up'), '15');
  await user.click(dialog.getByRole('button', { name: 'Add Service' }));
  expect(screen.getByText('Services (2)')).toBeInTheDocument();
  expect(screen.getByText('15 min')).toBeInTheDocument();
  expect(screen.getByText('Inactive')).toBeInTheDocument();
});

it('only replaces clinic services after confirming defaults and preserves copied status', async () => {
  const user = userEvent.setup();
  vi.mocked(apiRequest).mockResolvedValue({ services: [{ id: 'template', name: 'Exam', description: 'Physical exam', durationMinutes: 45, status: 'INACTIVE' }] });
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Apply Doctor Defaults' }));
  expect(apiRequest).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Consultation')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Apply Doctor Defaults' }));
  await user.click(screen.getByRole('button', { name: 'Apply Defaults' }));
  expect(await screen.findByText('Exam')).toBeInTheDocument();
  expect(screen.queryByText('Consultation')).not.toBeInTheDocument();
  expect(screen.getByText('45 min')).toBeInTheDocument();
  expect(screen.getByText('Inactive')).toBeInTheDocument();
});

it('keeps existing services when loading defaults fails', async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error('Unable to load defaults'));
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Apply Doctor Defaults' }));
  await user.click(screen.getByRole('button', { name: 'Apply Defaults' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load defaults');
  expect(screen.getByText('Consultation')).toBeInTheDocument();
});
