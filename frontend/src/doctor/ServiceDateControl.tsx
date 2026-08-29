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

export function formatServiceDate(value: string, long = false) {
  return (long ? longFormatter : displayFormatter).format(parseDate(value));
}

export function ServiceDateControl({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const today = value === '2026-08-25';
  return <div className={`service-date-control${compact ? ' is-compact' : ''}`}><small>Service Date</small><div><button type="button" aria-label="Previous service date" onClick={() => onChange(shiftDate(value, -1))}>‹</button><label><span aria-hidden="true">▣</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label="Select service date" /><strong>{formatServiceDate(value)}</strong></label><button type="button" aria-label="Next service date" onClick={() => onChange(shiftDate(value, 1))}>›</button>{today ? <em>TODAY</em> : <button className="service-date-today" type="button" onClick={() => onChange('2026-08-25')}>Go to today</button>}</div></div>;
}
