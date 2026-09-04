import { useState } from 'react';
import {
  Card,
  Checklist,
  Help,
  LoadState,
  Note,
  useSettingsData,
} from './SettingsShared';
import { OperationsIcon } from '../OperationsIcon';

const notes = [
  'Audit records are read-only.',
  'Patient details and authentication secrets are excluded.',
  'Dates and times below are UTC.',
  'Only records scoped to your clinics are returned.',
];
type Audit = {
  items: {
    id: string;
    occurredAt: string;
    title: string;
    category: string;
    clinic: string;
    actor: string | null;
  }[];
  page: number;
  total: number;
  clinics: number;
  actors: number;
  coverage: string;
};
function Results({ from, to }: { from: string; to: string }) {
  const [page, setPage] = useState(1);
  const audit = useSettingsData<Audit>(
    `/doctor/audit-log?from=${from}&to=${to}&page=${page}`,
  );
  return (
    <>
      <LoadState
        error={audit.error}
        loading={!audit.data}
        retry={audit.reload}
      />
      {audit.data && !audit.error && (
        <>
          <Note>{audit.data.coverage}</Note>
          <div className="ds-row">
            <p>
              {audit.data.total} recorded events · {audit.data.clinics} clinics
              · {audit.data.actors} account actors in this range
            </p>
            <button onClick={() => window.print()}>
              <OperationsIcon name="print" size={18} /> Print this page
            </button>
          </div>
          <p>
            {from} – {to} (UTC), page {audit.data.page} of{' '}
            {Math.max(1, Math.ceil(audit.data.total / 50))}
          </p>
          {audit.data.items.map((item) => (
            <article className="ds-row" key={item.id}>
              <time dateTime={item.occurredAt}>
                {new Date(item.occurredAt).toLocaleString('en-US', {
                  timeZone: 'UTC',
                })}
              </time>
              <div>
                <h3>{item.title}</h3>
                <p>
                  {item.clinic} · {item.actor || 'Actor not recorded'}
                </p>
              </div>
              <span className="ds-badge">{item.category}</span>
            </article>
          ))}
          {!audit.data.items.length && <p>No recorded events in this range.</p>}
          <div className="ds-actions">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous page
            </button>
            <button
              disabled={page * 50 >= audit.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next page
            </button>
          </div>
        </>
      )}
    </>
  );
}
export function AuditSettings() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [range, setRange] = useState({ from, to });
  return (
    <>
      <div className="ds-main">
        <h2>Audit Log</h2>
        <p>Review recorded activity across your clinics.</p>
        <form
          className="ds-date-range"
          onSubmit={(event) => {
            event.preventDefault();
            setRange({ from, to });
          }}
        >
          <label>
            From
            <input
              required
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              required
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button className="ds-primary">Apply Dates</button>
        </form>
        <Results key={range.from + range.to} {...range} />
      </div>
      <aside className="ds-aside">
        <Card title="About Audit Log">
          <Checklist items={notes} />
        </Card>
        <Help title="Audit Guide" items={notes} />
      </aside>
    </>
  );
}
