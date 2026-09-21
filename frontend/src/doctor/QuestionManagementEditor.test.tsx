import { useState, type ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import { QuestionManagementEditor } from './QuestionManagementEditor';

vi.mock('../api/client', () => ({ apiRequest: vi.fn() }));
type Rows = ComponentProps<typeof QuestionManagementEditor>['questions'];
const initial: Rows = [{ id: 'q1', order: 0, question: 'Reason for visit?', type: 'TEXT', active: true, required: false }];
function Harness({ rows = initial }: { rows?: Rows }) {
  const [questions, setQuestions] = useState(rows);
  return <><QuestionManagementEditor questions={questions} setQuestions={setQuestions} /><output data-testid="saved">{JSON.stringify(questions)}</output></>;
}
beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

it('discards canceled additions and edits, and validates and saves ordered choices', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: '+ Add Question' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Questions (1)')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit question Reason for visit?' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.clear(dialog.getByLabelText('Question text for Reason for visit?'));
  await user.type(dialog.getByLabelText('Question text for'), 'Changed');
  await user.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Reason for visit?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '+ Add Question' }));
  await user.type(dialog.getByLabelText('Question text for'), 'Visit type?');
  await user.selectOptions(dialog.getByLabelText('Question type for Visit type?'), 'SINGLE_SELECT');
  await user.click(dialog.getByRole('button', { name: 'Add Question' }));
  expect(screen.getByRole('alert')).toHaveTextContent('at least 2 options');
  await user.type(dialog.getByLabelText('Option 1 for Visit type?'), 'First visit');
  await user.type(dialog.getByLabelText('Option 2 for Visit type?'), 'Follow-up');
  await user.click(dialog.getByRole('button', { name: 'Move option 2 up' }));
  await user.click(dialog.getByLabelText('Required for Visit type?'));
  await user.click(dialog.getByRole('button', { name: 'Add Question' }));
  const rows = JSON.parse(screen.getByTestId('saved').textContent!) as Rows;
  expect(rows[1]).toMatchObject({ question: 'Visit type?', order: 1, required: true, type: 'SINGLE_SELECT' });
  expect(rows[1].options?.map((option) => option.label)).toEqual(['Follow-up', 'First visit']);
});

it('adds further questions as inactive once five are active', async () => {
  const user = userEvent.setup();
  render(<Harness rows={Array.from({ length: 5 }, (_, index) => ({ ...initial[0], id: `q${index}`, order: index, question: `Question ${index}` }))} />);
  await user.click(screen.getByRole('button', { name: '+ Add Question' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Question text for'), 'Extra question');
  expect(dialog.getByLabelText('Status for Extra question')).toHaveValue('INACTIVE');
  expect(dialog.getByRole('option', { name: 'Active' })).toBeDisabled();
  await user.click(dialog.getByRole('button', { name: 'Add Question' }));
  expect(screen.getByText('Inactive')).toHaveClass('is-inactive');
  expect(screen.getByText('Questions (6)')).toBeInTheDocument();
});

it('confirms replacement and copies default question settings, options and order', async () => {
  const user = userEvent.setup();
  vi.mocked(apiRequest).mockResolvedValue({ bookingQuestions: [
    { id: 'late', questionText: 'Visit type?', type: 'SINGLE_SELECT', isRequired: true, isActive: false, displayOrder: 2, selectOptions: [{ value: 'new', label: 'New' }, { value: 'return', label: 'Return' }] },
    { id: 'early', questionText: 'Age?', type: 'NUMBER', isRequired: false, isActive: true, displayOrder: 0 },
  ] });
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Apply Doctor Defaults' }));
  expect(apiRequest).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Reason for visit?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Apply Doctor Defaults' }));
  await user.click(screen.getByRole('button', { name: 'Apply Defaults' }));
  expect(await screen.findByText('Age?')).toBeInTheDocument();
  const rows = JSON.parse(screen.getByTestId('saved').textContent!) as Rows;
  expect(rows.map((row) => row.question)).toEqual(['Age?', 'Visit type?']);
  expect(rows[1]).toMatchObject({ sourceDoctorBookingQuestionTemplateId: 'late', required: true, active: false, options: [{ value: 'new', label: 'New' }, { value: 'return', label: 'Return' }] });
});

it('preserves clinic questions when defaults exceed the active limit or fail to load', async () => {
  const user = userEvent.setup();
  vi.mocked(apiRequest).mockResolvedValueOnce({ bookingQuestions: Array.from({ length: 6 }, (_, displayOrder) => ({ id: String(displayOrder), questionText: 'Question', type: 'TEXT', isActive: true, isRequired: false, displayOrder })) }).mockRejectedValueOnce(new Error('Unable to load defaults'));
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Apply Doctor Defaults' }));
  await user.click(screen.getByRole('button', { name: 'Apply Defaults' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('more than 5 active');
  expect(JSON.parse(screen.getByTestId('saved').textContent!)).toEqual(initial);
  await user.click(screen.getByRole('button', { name: 'Apply Defaults' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load defaults');
  expect(JSON.parse(screen.getByTestId('saved').textContent!)).toEqual(initial);
});
