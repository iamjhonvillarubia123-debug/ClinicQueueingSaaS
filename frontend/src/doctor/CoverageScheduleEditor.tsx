import { useId, useRef, useState } from 'react';
import { formatCoverage, mergeCoverage, type CoverageRange } from './coverage-ranges';
import './CoverageScheduleEditor.css';

type EntryMode = 'DAY' | 'RANGE' | 'WEEKDAYS';
type Draft = { mode: EntryMode; from: string; to: string; weekdays: number[] };
const blank: Draft = { mode: 'DAY', from: '', to: '', weekdays: [1, 3, 5] };
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function draftRanges(draft: Draft): CoverageRange[] {
  const to = draft.mode === 'DAY' ? draft.from : draft.to;
  if (!draft.from || !to || draft.from > to) return [];
  const start = new Date(draft.from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || (end - start) / 86400000 >= 366) return [];
  if (draft.mode !== 'WEEKDAYS') return [{ fromServiceDate: draft.from, toServiceDate: to }];
  const ranges: CoverageRange[] = [];
  for (let cursor = start; cursor <= end; cursor += 86400000) {
    const date = new Date(cursor);
    if (draft.weekdays.includes(date.getUTCDay())) ranges.push({ fromServiceDate: date.toISOString().slice(0, 10), toServiceDate: date.toISOString().slice(0, 10) });
  }
  return mergeCoverage(ranges);
}
export function CoverageScheduleEditor({ initialRanges = [], onChange }: { initialRanges?: CoverageRange[]; onChange: (ranges: CoverageRange[]) => void }) {
  const titleId = useId();
  const nextId = useRef(initialRanges.length);
  const [periods, setPeriods] = useState<(Draft & { id: number })[]>(() => initialRanges.map((range, id) => ({ id, mode: range.fromServiceDate === range.toServiceDate ? 'DAY' : 'RANGE', from: range.fromServiceDate, to: range.toServiceDate, weekdays: [1, 3, 5] })));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const combined = mergeCoverage(periods.flatMap(draftRanges));
  const countDays = (ranges: CoverageRange[]) => ranges.reduce((count, range) => count + (new Date(range.toServiceDate).getTime() - new Date(range.fromServiceDate).getTime()) / 86400000 + 1, 0);
  const total = countDays(combined);
  const ranges = draft ? draftRanges(draft) : [];
  const proposed = mergeCoverage([...periods.filter((period) => period.id !== editingId).flatMap(draftRanges), ...ranges]);
  const overLimit = countDays(proposed) > 366 || proposed.length > 100;
  function publish(next: typeof periods) {
    setPeriods(next);
    onChange(mergeCoverage(next.flatMap(draftRanges)));
  }
  function change(patch: Partial<Draft>) { setDraft((current) => current ? { ...current, ...patch } : current); }
  function close() { setDraft(null); setEditingId(null); onChange(combined); }
  return <div className="coverage-schedule-editor">
    <p>Add periods to combine different dates and weekdays in one invitation.</p>
    {periods.length ? <ul className="coverage-entry-list">{periods.map((period, index) => <li key={period.id}>
      <div className="coverage-period-summary"><strong>{period.mode === 'DAY' ? 'One Clinic Day' : period.mode === 'RANGE' ? 'Date Range' : [1, 2, 3, 4, 5, 6, 0].filter((day) => period.weekdays.includes(day)).map((day) => days[day]).join(', ')}</strong><span>{formatCoverage([{ fromServiceDate: period.from, toServiceDate: period.mode === 'DAY' ? period.from : period.to }])}</span></div>
      <div className="coverage-row-actions">
        <button type="button" disabled={draft !== null} aria-label={'Edit period ' + (index + 1)} title="Edit period" onClick={() => { setDraft({ ...period }); setEditingId(period.id); onChange([]); }}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5" /></svg></button>
        <button type="button" disabled={draft !== null} aria-label={'Remove period ' + (index + 1)} title="Remove period" onClick={() => publish(periods.filter((item) => item.id !== period.id))}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7" /></svg></button>
      </div>
    </li>)}</ul> : !draft ? <p className="coverage-entry-preview">No periods added yet.</p> : null}
    {draft ? <section className="coverage-period" aria-labelledby={titleId}>
      <div className="coverage-period-header"><h4 id={titleId}>{editingId === null ? 'Add period' : 'Edit period'}</h4></div>
        <div className="coverage-entry-modes">
          {([['DAY', 'One Clinic Day'], ['RANGE', 'Date Range'], ['WEEKDAYS', 'Selected weekdays']] as const).map(([value, label]) => <label key={value}><input type="radio" name={titleId + '-mode'} checked={draft.mode === value} onChange={() => change({ mode: value, to: value === 'DAY' ? draft.from : draft.to })} />{label}</label>)}
        </div>
        <div className="staff-date-fields">
          <label>From<input type="date" value={draft.from} onChange={(event) => change({ from: event.target.value, ...(draft.mode === 'DAY' ? { to: event.target.value } : {}) })} /></label>
          <label>To<input type="date" disabled={draft.mode === 'DAY'} value={draft.mode === 'DAY' ? draft.from : draft.to} onChange={(event) => change({ to: event.target.value })} /></label>
        </div>
        {draft.mode === 'WEEKDAYS' ? <fieldset className="coverage-weekdays"><legend>Repeat on these days within this period</legend>{[1, 2, 3, 4, 5, 6, 0].map((day) => <label key={day}><input type="checkbox" checked={draft.weekdays.includes(day)} onChange={() => change({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((value) => value !== day) : [...draft.weekdays, day] })} />{days[day]}</label>)}</fieldset> : null}
      {!ranges.length && (draft.from || draft.to) ? <p role="alert">Choose valid dates with at least one matching day, within a 366-day period.</p> : null}
      {overLimit ? <p role="alert">Choose up to 366 days across at most 100 periods per invitation.</p> : null}
      <div className="coverage-entry-actions"><button type="button" disabled={!ranges.length || overLimit} onClick={() => {
        publish(editingId === null ? [...periods, { ...draft, id: nextId.current++ }] : periods.map((period) => period.id === editingId ? { ...draft, id: period.id } : period));
        setDraft(null); setEditingId(null);
      }}>{editingId === null ? 'Add' : 'Save changes'}</button><button type="button" onClick={close}>Cancel</button></div>
    </section> : <div className="coverage-entry-actions"><button type="button" onClick={() => { setDraft({ ...blank }); setEditingId(null); onChange([]); }}>Add period</button></div>}
    {periods.length ? <div className="coverage-total"><strong>{total} unique coverage {total === 1 ? 'day' : 'days'}</strong><small>Overlapping dates count only once.</small></div> : null}
  </div>;
}
