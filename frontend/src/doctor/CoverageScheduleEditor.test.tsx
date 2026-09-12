import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CoverageScheduleEditor } from './CoverageScheduleEditor';
afterEach(cleanup);
function dates(from: string, to: string) {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: to } });
}
it('adds compact weekday summaries and edits and removes individual periods', async () => {
  const user = userEvent.setup(); const onChange = vi.fn();
  render(<CoverageScheduleEditor onChange={onChange} />);
  expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  for (const [from, to, toggles] of [
    ['2026-09-10', '2026-09-15', []],
    ['2026-09-16', '2026-09-30', ['Mon', 'Wed', 'Fri', 'Tue', 'Thu']],
    ['2026-10-01', '2026-10-31', ['Mon', 'Wed', 'Fri', 'Sun']],
  ] as const) {
    await user.click(screen.getByRole('button', { name: 'Add period' }));
    await user.click(screen.getByLabelText('Selected weekdays'));
    dates(from, to);
    for (const day of toggles) await user.click(screen.getByLabelText(day));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  }
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('Mon, Wed, Fri')).toBeInTheDocument();
  expect(screen.getByText('Tue, Thu')).toBeInTheDocument();
  expect(screen.getByText('Sun')).toBeInTheDocument();
  expect(onChange).toHaveBeenLastCalledWith(['2026-09-11', '2026-09-14', '2026-09-17', '2026-09-22', '2026-09-24', '2026-09-29', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map(day => ({ fromServiceDate: day, toServiceDate: day })));
  await user.click(screen.getByRole('button', { name: 'Edit period 1' }));
  expect(screen.getByLabelText('From')).toHaveValue('2026-09-10');
  expect(screen.getByLabelText('Mon')).toBeChecked();
  await user.click(screen.getByLabelText('Fri'));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByText('9 unique coverage days')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Remove period 2' }));
  expect(screen.getByText('5 unique coverage days')).toBeInTheDocument();
});
it('blocks unsaved drafts, cancels edits without changing saved dates, and removes the last period', async () => {
  const user = userEvent.setup(); const onChange = vi.fn();
  const initialRanges = [{ fromServiceDate: '2027-01-04', toServiceDate: '2027-01-10' }];
  render(<CoverageScheduleEditor initialRanges={initialRanges} onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: 'Edit period 1' }));
  dates('2027-01-11', '2027-01-10');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(onChange).toHaveBeenLastCalledWith([]);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onChange).toHaveBeenLastCalledWith(initialRanges);
  await user.click(screen.getByRole('button', { name: 'Add period' }));
  expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  await user.click(screen.getByLabelText('Selected weekdays'));
  dates('2027-01-05', '2027-01-05');
  expect(screen.getByRole('alert')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: 'Remove period 1' }));
  expect(onChange).toHaveBeenLastCalledWith([]);
  expect(screen.getByRole('button', { name: 'Add period' })).toBeEnabled();
});
