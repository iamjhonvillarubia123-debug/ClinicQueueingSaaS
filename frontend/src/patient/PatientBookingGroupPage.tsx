import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import { formatQueueNumber } from '../presentation/queueNumber';

type AppointmentStatus =
  | 'WAITING'
  | 'CALLED'
  | 'SERVING'
  | 'TEMPORARILY_ABSENT'
  | 'OUT_FOR_PROCEDURE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

type GroupMember = {
  bookingReference: string;
  queueNumber: number;
  status: AppointmentStatus;
  servingOrderKey: string | number | null;
  waitingPlacementType: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  suffix: string | null;
};

type GroupDashboard = {
  serviceDate: string;
  servingProtectionEndedAt: string | null;
  visibleMemberCount: number;
  members: GroupMember[];
};

type ViewState = 'loading' | 'ready' | 'inaccessible' | 'error';

function formatName(member: GroupMember) {
  return [member.firstName, member.middleName, member.lastName, member.suffix].filter(Boolean).join(' ') || 'Patient';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function statusLabel(status: AppointmentStatus) {
  return status.replaceAll('_', ' ').toLowerCase();
}

function memberGuidance(status: AppointmentStatus) {
  if (status === 'TEMPORARILY_ABSENT') {
    return 'This member cannot use I’m Here. Please approach clinic staff for reinsertion.';
  }
  if (status === 'OUT_FOR_PROCEDURE') {
    return 'Clinic staff will return this member to the queue when appropriate. The Queue Number stays the same.';
  }
  if (status === 'CALLED') return 'This Queue Number has been called.';
  if (status === 'SERVING') return 'This member is currently being served.';
  if (status === 'COMPLETED') return 'This appointment is completed.';
  if (status === 'CANCELLED') return 'This appointment is cancelled.';
  if (status === 'NO_SHOW') return 'Please contact clinic staff if this member needs assistance.';
  return 'This member keeps this permanent Queue Number throughout the appointment.';
}

export function PatientBookingGroupPage() {
  const [dashboard, setDashboard] = useState<GroupDashboard | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setViewState('loading');
    setMessage('');
    try {
      const result = await apiRequest<GroupDashboard>('/patient-booking-groups/dashboard');
      setDashboard(result);
      setViewState('ready');
    } catch (error) {
      setDashboard(null);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
        setViewState('inaccessible');
      } else {
        setMessage(error instanceof ApiError ? error.message : 'Unable to load this group booking right now.');
        setViewState('error');
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="public-detail patient-dashboard-page">
      <header className="public-header">
        <Link className="brand" to="/">Clinic Queueing</Link>
        {viewState === 'ready' ? <button className="text-button patient-refresh" type="button" onClick={() => void load()}>Refresh</button> : null}
      </header>

      {viewState === 'loading' ? (
        <section className="patient-dashboard patient-state" aria-live="polite"><p className="eyebrow">Group booking</p><h1>Loading group queue status…</h1></section>
      ) : null}

      {viewState === 'inaccessible' ? (
        <section className="patient-dashboard patient-state"><p className="eyebrow">Group booking</p><h1>Group access is unavailable.</h1><p>This device does not currently have controller access to this group booking. Use the approved recovery flow or contact the clinic if you need help.</p></section>
      ) : null}

      {viewState === 'error' ? (
        <section className="patient-dashboard patient-state"><p className="eyebrow">Connection problem</p><h1>We could not load the group booking.</h1><p>{message}</p><button className="secondary" type="button" onClick={() => void load()}>Try again</button></section>
      ) : null}

      {viewState === 'ready' && dashboard ? (
        <article className="patient-dashboard group-dashboard" aria-live="polite">
          <section className="patient-dashboard-hero">
            <p className="eyebrow">Group booking</p>
            <h1>{dashboard.visibleMemberCount} confirmed {dashboard.visibleMemberCount === 1 ? 'person' : 'people'}</h1>
            <p>Each person remains an independent Appointment with their own permanent Queue Number. Group members do not use the individual I’m Here action.</p>
          </section>

          <section className="group-summary" aria-label="Group booking summary">
            <div><span>Service date</span><strong>{formatDate(dashboard.serviceDate)}</strong></div>
            <div><span>Group serving protection</span><strong>{dashboard.servingProtectionEndedAt ? 'Ended' : 'Active'}</strong></div>
          </section>

          <section className="group-members" aria-labelledby="group-members-heading">
            <h2 id="group-members-heading">People in this booking</h2>
            {dashboard.members.map((member) => (
              <article className="group-member" key={member.bookingReference}>
                <div className="group-member-queue" aria-label={`Queue number ${member.queueNumber}`}>
                  <span>Queue</span><strong>{formatQueueNumber(member.queueNumber)}</strong>
                </div>
                <div className="group-member-body">
                  <div className="group-member-heading">
                    <div><h3>{formatName(member)}</h3><p>{member.bookingReference}</p></div>
                    <span className="group-status">{statusLabel(member.status)}</span>
                  </div>
                  <p>{memberGuidance(member.status)}</p>
                </div>
              </article>
            ))}
          </section>
        </article>
      ) : null}
    </main>
  );
}
