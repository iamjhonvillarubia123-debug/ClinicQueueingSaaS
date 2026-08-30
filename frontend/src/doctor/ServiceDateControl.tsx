import { useEffect, useMemo, useRef, useState } from 'react';
import { OperationsIcon } from './OperationsIcon';

const displayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const longFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function shiftDate(value: string, days: number) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function calendarDays(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

export function formatServiceDate(value: string, long = false) {
  return (long ? longFormatter : displayFormatter).format(parseDate(value));
}

export function ServiceDateControl({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const today = value === '2026-08-25';
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(monthKey(value));
  const rootRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseDate(`${visibleMonth}-01`));

  useEffect(() => setVisibleMonth(monthKey(value)), [value]);
  useEffect(() => {
    function closeOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, []);

  function chooseDate(nextDate: string) {
    onChange(nextDate);
    setOpen(false);
  }

  return <div ref={rootRef} className={`service-date-control${compact ? ' is-compact' : ''}`}><small>Service Date</small><input className="service-date-value" readOnly value={value} aria-label="Select service date" /><div className="service-date-row"><button type="button" aria-label="Previous service date" onClick={() => onChange(shiftDate(value, -1))}>‹</button><button className="service-date-trigger" type="button" aria-label="Open service date calendar" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span aria-hidden="true"><OperationsIcon name="calendar" size={17} /></span><strong>{formatServiceDate(value)}</strong></button><button type="button" aria-label="Next service date" onClick={() => onChange(shiftDate(value, 1))}>›</button>{today ? <em>TODAY</em> : <button className="service-date-today" type="button" onClick={() => chooseDate('2026-08-25')}>Go to today</button>}</div>{open ? <div className="service-calendar" role="dialog" aria-label="Choose service date"><header><button type="button" aria-label="Previous month" onClick={() => setVisibleMonth((current) => shiftMonth(current, -1))}>‹</button><strong>{monthLabel}</strong><button type="button" aria-label="Next month" onClick={() => setVisibleMonth((current) => shiftMonth(current, 1))}>›</button></header><div className="service-calendar-weekdays">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day}>{day}</span>)}</div><div className="service-calendar-days">{days.map((day) => <button className={`${monthKey(day) === visibleMonth ? '' : 'is-outside'}${day === value ? ' is-selected' : ''}${day === '2026-08-25' ? ' is-today' : ''}`.trim()} type="button" key={day} onClick={() => chooseDate(day)} aria-label={formatServiceDate(day)} aria-pressed={day === value}>{Number(day.slice(-2))}</button>)}</div><footer><button type="button" onClick={() => chooseDate('2026-08-25')}>Go to today</button><button type="button" onClick={() => setOpen(false)}>Close</button></footer></div> : null}</div>;
}
