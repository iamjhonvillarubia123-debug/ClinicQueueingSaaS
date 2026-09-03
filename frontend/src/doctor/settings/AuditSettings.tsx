import { useState } from 'react';
import { Card, Checklist, Help, Unconnected } from './SettingsShared';
import { OperationsIcon } from '../OperationsIcon';

const notes = [
  'Audit records are read-only.',
  'A complete history should show what happened, when, where, and who performed each action.',
  'Patient information must follow the retention policy.',
  'Passwords and sensitive security data must not appear in audit records.',
];
export function AuditSettings() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <>
      <div className="ds-main">
        <div className="ds-row">
          <div>
            <h2>Audit Log</h2>
            <p>Review important activity across your account and clinics.</p>
          </div>
          <button
            disabled
            title="Printing will be available when audit records are connected"
          >
            <OperationsIcon name="print" size={18} /> Print
          </button>
        </div>
        <div className="ds-date-range">
          <label>
            From
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>
        <Unconnected reason="Audit records exist internally, but there is no Doctor-facing endpoint for a combined account-and-clinic timeline, date filtering, or activity totals." />
        <div className="ds-empty ds-audit-empty">
          <OperationsIcon name="clock" size={36} />
          <h3>Audit history is not connected yet</h3>
          <p>No records or summary counts are simulated.</p>
        </div>
      </div>
      <aside className="ds-aside">
        <Card title="About Audit Log">
          <Checklist items={notes} />
        </Card>
        <Card title="Activity Summary" icon="calendar">
          {[
            'Total actions',
            'Actions this month',
            'Clinics with activity',
            'Staff involved',
          ].map((item) => (
            <div className="ds-row" key={item}>
              <strong>—</strong>
              <span>{item}</span>
            </div>
          ))}
        </Card>
        <Help title="Audit Guide" items={notes} />
      </aside>
    </>
  );
}
