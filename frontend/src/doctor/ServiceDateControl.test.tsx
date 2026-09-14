import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ServiceDateControl,
  ServiceDateTodayProvider,
  formatServiceDate,
} from './ServiceDateControl';

afterEach(cleanup);

describe('ServiceDateControl', () => {
  it('uses the authoritative clinic-local today instead of a hard-coded date', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <ServiceDateTodayProvider today="2026-08-31">
        <ServiceDateControl value="2026-08-30" onChange={onChange} />
      </ServiceDateTodayProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(onChange).toHaveBeenCalledWith('2026-08-31');
  });

  it('marks the authoritative clinic-local date as today', () => {
    render(
      <ServiceDateTodayProvider today="2026-08-31">
        <ServiceDateControl value="2026-08-31" onChange={vi.fn()} />
      </ServiceDateTodayProvider>,
    );

    expect(screen.getByText('TODAY')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to today' })).not.toBeInTheDocument();
  });

  it('formats canonical date-only values without timezone date shifting', () => {
    expect(formatServiceDate('2026-08-31', true)).toBe('August 31, 2026');
  });
});

it('limits substitute dates and skips gaps with next and previous controls', async () => {
  const user = userEvent.setup(); const onChange = vi.fn();
  render(<ServiceDateTodayProvider today="2026-09-01" allowedRanges={[{ fromServiceDate: '2026-09-02', toServiceDate: '2026-09-02' }, { fromServiceDate: '2026-09-07', toServiceDate: '2026-09-09' }]}><ServiceDateControl value="2026-09-02" onChange={onChange} /></ServiceDateTodayProvider>);
  expect(screen.getByRole('button', { name: 'Previous service date' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Go to today' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next service date' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-09-07');
  await user.click(screen.getByRole('button', { name: 'Open service date calendar' }));
  expect(screen.getByRole('button', { name: formatServiceDate('2026-09-03') })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: formatServiceDate('2026-09-08') }));
  expect(onChange).toHaveBeenLastCalledWith('2026-09-08');
});
