import { useState } from 'react';
import { apiRequest } from '../../api/client';
import {
  Card,
  Checklist,
  dateTime,
  Drawer,
  Help,
  LoadState,
  Note,
  Unconnected,
  useSettingsData,
} from './SettingsShared';

type PrivacyProfile = {
  acknowledgementVersion: string;
  terminalAppointmentIdentifiableRetentionHours: number;
  permanentlyClosedAccountMinimizationDays: number;
  currentAcknowledgementSatisfied: boolean;
  acknowledgedAt: string | null;
  finalPrivacyErasureIsIrreversible: boolean;
  anonymousAggregateQueueAnalyticsMayRemain: boolean;
};
const privacyNotes = [
  'Patient information is retained for operational use under the system retention policy.',
  'Final privacy erasure is irreversible.',
  'Anonymous aggregate analytics may remain after erasure.',
  'Clinics cannot extend patient retention themselves.',
  'This system is not permanent medical-record storage.',
];

export function PrivacySettings({ onAccount }: { onAccount: () => void }) {
  const privacy = useSettingsData<PrivacyProfile>(
    '/doctor/account/data-privacy',
  );
  const [panel, setPanel] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function acknowledge() {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/doctor/account/data-retention-acknowledgement', {
        method: 'POST',
        body: { acknowledged: true },
      });
      privacy.reload();
      setPanel('');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Unable to save acknowledgment.',
      );
    } finally {
      setBusy(false);
    }
  }
  function open(value: string) {
    setPanel(value);
    setAgree(false);
    setError('');
  }
  return (
    <>
      <div className="ds-main">
        <p>Understand how your data is handled, retained, and protected.</p>
        <LoadState
          error={privacy.error}
          loading={!privacy.data}
          retry={privacy.reload}
        />
        <Card
          title="1. Patient Data Retention"
          description="Patient queue and appointment data is retained for operational use."
          icon="shield"
        >
          <div className="ds-two">
            <div className="ds-tile ds-lilac">
              <h3>Identifiable Appointment & Queue Data</h3>
              <span className="ds-badge">Short-term retention</span>
              <p>
                {privacy.data
                  ? `Identifiable terminal appointment data follows a ${privacy.data.terminalAppointmentIdentifiableRetentionHours}-hour retention period under the current policy.`
                  : 'Current policy details are not loaded.'}
              </p>
            </div>
            <Checklist items={privacyNotes.slice(1)} />
          </div>
          <button
            disabled={!privacy.data}
            onClick={() => open('Patient Data Retention Policy')}
          >
            View Retention Policy
          </button>
        </Card>
        <Card
          title="2. Automatic Privacy Erasure"
          description="Eligible patient-identifiable data follows the system-managed retention lifecycle."
          icon="calendar"
        >
          <div className="ds-lifecycle">
            {[
              ['Operational Use', 'During clinic and appointment operations.'],
              [
                'Retention Period',
                'Data follows the approved operational retention period.',
              ],
              [
                'Permanent Erasure',
                'Eligible identifiable data is permanently erased.',
              ],
              [
                'Anonymous Analytics',
                'Only non-identifying aggregate analytics may remain.',
              ],
            ].map(([title, description]) => (
              <div className="ds-tile" key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            ))}
          </div>
          <Note>
            Final erasure removes patient identity. The current API describes
            policy, but does not report whether the erasure worker is running.
          </Note>
        </Card>
        <Card
          title="3. Data Retention Acknowledgement"
          description="Review your acknowledgment of the current retention policy."
          icon="check"
        >
          <div className="ds-account-grid">
            <div>
              <small>Policy Version</small>
              <strong>
                {privacy.data?.acknowledgementVersion ?? 'Not available'}
              </strong>
            </div>
            <div>
              <small>Acknowledged On</small>
              <strong>{dateTime(privacy.data?.acknowledgedAt)}</strong>
            </div>
            <div>
              <small>Status</small>
              <strong>
                {privacy.data
                  ? privacy.data.currentAcknowledgementSatisfied
                    ? 'Acknowledged'
                    : 'Acknowledgment required'
                  : 'Not available'}
              </strong>
            </div>
          </div>
          <button
            disabled={!privacy.data}
            onClick={() => open('Data Retention Acknowledgement')}
          >
            {privacy.data?.currentAcknowledgementSatisfied
              ? 'View Acknowledgement'
              : 'Review & Acknowledge'}
          </button>
        </Card>
        <Card
          title="4. Your Account & Privacy Information"
          description="Review how account and practice information is handled."
          icon="person"
        >
          <div className="ds-two">
            <div className="ds-tile">
              <h3>Account & Practice Information</h3>
              <p>Review the available system privacy policy.</p>
              <button
                onClick={() => open('Account & Practice Privacy Information')}
              >
                View Privacy Information
              </button>
            </div>
            <div className="ds-tile">
              <h3>Request Account Data (Summary)</h3>
              <p>Request a summary of your account and practice information.</p>
              <button onClick={() => open('Request Account Data')}>
                Request Account Data
              </button>
            </div>
          </div>
        </Card>
        <Card
          title="5. Account Privacy"
          description="Manage account lifecycle actions that affect access."
          icon="shield"
        >
          <button onClick={onAccount}>Go to Account & Security ›</button>
        </Card>
      </div>
      <aside className="ds-aside">
        <Card title="About Data & Privacy">
          <Checklist items={privacyNotes} />
        </Card>
        <Card title="Privacy Status" icon="shield">
          <div className="ds-row">
            Retention Policy{' '}
            <span className="ds-badge">
              {privacy.data ? 'System Managed' : 'Not loaded'}
            </span>
          </div>
          <div className="ds-row">
            Acknowledgement{' '}
            <span className="ds-badge">
              {privacy.data
                ? privacy.data.currentAcknowledgementSatisfied
                  ? 'Completed'
                  : 'Required'
                : 'Not loaded'}
            </span>
          </div>
          <div className="ds-row">
            Erasure Worker <span className="ds-badge">Status unavailable</span>
          </div>
        </Card>
        <Help title="Privacy Guide" items={privacyNotes} />
      </aside>
      {panel && (
        <Drawer
          title={panel}
          busy={busy}
          onClose={() => {
            if (!busy) setPanel('');
          }}
        >
          {panel === 'Request Account Data' ? (
            <>
              <p>
                Request a summary of your Doctor account and practice
                information.
              </p>
              <Unconnected reason="No account-data request or export endpoint exists in the current API." />
              <button disabled>Submit Request</button>
            </>
          ) : (
            <>
              <Checklist items={privacyNotes} />
              {privacy.data && (
                <>
                  <dl>
                    <dt>Policy version</dt>
                    <dd>{privacy.data.acknowledgementVersion}</dd>
                    <dt>Terminal appointment identifiable retention</dt>
                    <dd>
                      {
                        privacy.data
                          .terminalAppointmentIdentifiableRetentionHours
                      }{' '}
                      hours
                    </dd>
                    <dt>Permanently closed account minimization</dt>
                    <dd>
                      {privacy.data.permanentlyClosedAccountMinimizationDays}{' '}
                      days
                    </dd>
                  </dl>
                  <Note>
                    Your clinic is responsible for keeping any required
                    permanent clinical or medical records outside this system.
                  </Note>
                </>
              )}
              {panel === 'Data Retention Acknowledgement' && (
                <>
                  <p>
                    Acknowledged on: {dateTime(privacy.data?.acknowledgedAt)}
                  </p>
                  <p>
                    Acknowledged by: this Doctor account. A display name is not
                    exposed by the account API.
                  </p>
                  {privacy.data &&
                    !privacy.data.currentAcknowledgementSatisfied && (
                      <>
                        <label className="ds-checkbox">
                          <input
                            type="checkbox"
                            checked={agree}
                            disabled={busy}
                            onChange={(event) => setAgree(event.target.checked)}
                          />
                          I have read and acknowledge the current data retention
                          policy and its consequences.
                        </label>
                        <button
                          className="ds-primary"
                          disabled={busy || !agree}
                          onClick={() => void acknowledge()}
                        >
                          {busy ? 'Saving…' : 'Acknowledge Policy'}
                        </button>
                      </>
                    )}
                </>
              )}
              {panel === 'Account & Practice Privacy Information' && (
                <Unconnected reason="The policy is available, but a personalized account and practice data inventory is not exposed by the backend." />
              )}
            </>
          )}
          {error && (
            <p role="alert" className="ds-error">
              {error}
            </p>
          )}
          <footer>
            <button disabled={busy} onClick={() => setPanel('')}>
              Close
            </button>
          </footer>
        </Drawer>
      )}
    </>
  );
}
