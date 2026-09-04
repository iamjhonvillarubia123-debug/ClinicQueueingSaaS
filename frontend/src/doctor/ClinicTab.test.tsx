import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { HoursEditor, type DayHours } from './ClinicTab';

afterEach(cleanup);

const testHours: DayHours[] = [
  { day: 'Monday', open: true, opens: '08:00 AM', closes: '05:00 PM', maximumUntil: '06:00 PM' },
  { day: 'Tuesday', open: true, opens: '09:15 AM', closes: '04:15 PM', maximumUntil: '05:15 PM' },
  { day: 'Saturday', open: false, opens: '09:00 AM', closes: '01:00 PM', maximumUntil: '02:00 PM' },
];

function HoursHarness() {
  const [hours, setHours] = useState(testHours);
  const [cutoffLeadHours, setCutoffLeadHours] = useState(2);
  return <HoursEditor hours={hours} setHours={setHours} cutoffLeadHours={cutoffLeadHours} setCutoffLeadHours={setCutoffLeadHours} />;
}

describe('HoursEditor', () => {
  it('opens the complete 24-hour list without clearing the current value and normalizes manual times', async () => {
    const user = userEvent.setup();
    render(<HoursHarness />);
    const mondayOpening = screen.getByLabelText('Monday opening time');

    await user.click(mondayOpening);
    const options = screen.getAllByRole('option');

    expect(options).toHaveLength(96);
    expect(options[0]).toHaveTextContent('12:00 AM');
    expect(options[1]).toHaveTextContent('12:15 AM');
    expect(options[95]).toHaveTextContent('11:45 PM');
    expect(mondayOpening).toHaveValue('08:00 AM');

    await user.click(options[95]);
    expect(mondayOpening).toHaveValue('11:45 PM');

    await user.clear(mondayOpening);
    await user.type(mondayOpening, '8:07am');
    await user.tab();
    expect(mondayOpening).toHaveValue('08:07 AM');

    await user.click(mondayOpening);
    await user.clear(mondayOpening);
    await user.type(mondayOpening, '12:00bn');
    await user.tab();
    expect(mondayOpening).toHaveValue('08:07 AM');
  });

  it('keeps only one time menu open and skips arrow buttons while tabbing through time fields', async () => {
    const user = userEvent.setup();
    render(<HoursHarness />);
    const mondayOpening = screen.getByLabelText('Monday opening time');
    const mondayClosing = screen.getByLabelText('Monday closing time');
    const mondayMaximum = screen.getByLabelText('Monday maximum operating time');
    const tuesdayOpening = screen.getByLabelText('Tuesday opening time');

    await user.click(mondayOpening);
    expect(screen.getByRole('listbox', { name: 'Monday opening time choices' })).toBeInTheDocument();

    await user.click(mondayClosing);
    expect(screen.queryByRole('listbox', { name: 'Monday opening time choices' })).not.toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Monday closing time choices' })).toBeInTheDocument();
    expect(screen.getAllByRole('listbox')).toHaveLength(1);

    await user.click(mondayOpening);
    await user.tab();
    expect(mondayClosing).toHaveFocus();
    await user.tab();
    expect(mondayMaximum).toHaveFocus();
    await user.tab();
    expect(tuesdayOpening).toHaveFocus();
    await user.tab({ shift: true });
    expect(mondayMaximum).toHaveFocus();
  });

  it('copies only schedule inputs and lets the cutoff recalculate from the pasted closing time', async () => {
    const user = userEvent.setup();
    render(<HoursHarness />);

    await user.click(screen.getByRole('button', { name: 'Copy Monday schedule' }));
    await user.click(screen.getByRole('button', { name: 'Paste Monday schedule to Tuesday' }));

    expect(screen.getByLabelText('Tuesday opening time')).toHaveValue('08:00 AM');
    expect(screen.getByLabelText('Tuesday closing time')).toHaveValue('05:00 PM');
    expect(screen.getByLabelText('Tuesday maximum operating time')).toHaveValue('06:00 PM');
    expect(screen.getByLabelText('Tuesday online booking cutoff')).toHaveTextContent('03:00 PM');
  });

  it('does not allow maximum operating time to be earlier than closing in the frontend', async () => {
    const user = userEvent.setup();
    render(<HoursHarness />);
    const mondayMaximum = screen.getByLabelText('Monday maximum operating time');

    await user.click(mondayMaximum);
    const maximumChoices = screen.getAllByRole('option');
    expect(maximumChoices[0]).toHaveTextContent('05:00 PM');
    expect(maximumChoices.some((choice) => choice.textContent === '04:45 PM')).toBe(false);

    await user.clear(mondayMaximum);
    await user.type(mondayMaximum, '04:30 PM');
    await user.tab();
    expect(mondayMaximum).toHaveValue('06:00 PM');

    const mondayClosing = screen.getByLabelText('Monday closing time');
    await user.clear(mondayClosing);
    await user.type(mondayClosing, '07:00 PM');
    await user.tab();
    expect(mondayClosing).toHaveValue('07:00 PM');
    expect(mondayMaximum).toHaveValue('07:00 PM');
  });

  it('defaults maximum operating time to every newly selected closing time', async () => {
    const user = userEvent.setup();
    render(<HoursHarness />);
    const mondayClosing = screen.getByLabelText('Monday closing time');
    const mondayMaximum = screen.getByLabelText('Monday maximum operating time');

    expect(mondayClosing).toHaveValue('05:00 PM');
    expect(mondayMaximum).toHaveValue('06:00 PM');

    await user.click(mondayClosing);
    await user.click(screen.getByRole('option', { name: '12:00 PM' }));
    expect(mondayClosing).toHaveValue('12:00 PM');
    expect(mondayMaximum).toHaveValue('12:00 PM');
  });

  it('ends copy mode when the active source action is clicked a second time', async () => {
    const user = userEvent.setup();
    render(<HoursHarness />);

    await user.click(screen.getByRole('button', { name: 'Copy Monday schedule' }));
    expect(screen.getByRole('button', { name: 'End copying Monday schedule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste Monday schedule to Tuesday' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'End copying Monday schedule' }));
    expect(screen.getByRole('button', { name: 'Copy Monday schedule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Tuesday schedule' })).toBeInTheDocument();
  });

  it('keeps closed-row time fields and actions disabled', () => {
    render(<HoursHarness />);

    expect(screen.getByLabelText('Saturday opening time')).toBeDisabled();
    expect(screen.getByLabelText('Saturday closing time')).toBeDisabled();
    expect(screen.getByLabelText('Saturday maximum operating time')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy Saturday schedule' })).toBeDisabled();
  });
});
