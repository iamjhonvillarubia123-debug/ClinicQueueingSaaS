import { useMemo, useState } from 'react';
import {
  AppointmentDetailsDrawer,
  type AppointmentDetailsModel,
} from './AppointmentDetailsDrawer';
import {
  AuthoritativeAppointmentReportPreview,
  type AuthoritativeAppointmentReport,
} from './AuthoritativeAppointmentReportPreview';
import { AuthoritativeClinicStaffTab } from './AuthoritativeClinicStaffTab';
import {
  QueueActionDrawer,
  type QueueDrawerBookingConfiguration,
  type QueueDrawerCommand,
  type QueueDrawerMode,
} from './QueueActionDrawer';
import { OperationsIcon } from './OperationsIcon';
import { ServiceDateControl, formatServiceDate } from './ServiceDateControl';
import type {
  ClinicOperationsEvent,
  ClinicOperationsOverview,
  ClinicOperationsQueue,
} from './ClinicOperationsWorkspace';

type OperationsTab = 'overview' | 'queue' | 'appointments' | 'staff';
type PatientStatus =
  | 'WAITING'
  | 'NOW SERVING'
  | 'OUT FOR PROCEDURE'
  | 'TEMPORARILY ABSENT'
  | 'COMPLETED'
  | 'CANCELLED';

type PatientRow = {
  id: string;
  queue: string;
  name: string;
  reference: string;
  service: string;
  time: string;
  source: 'Online' | 'Staff-assisted';
  status: PatientStatus;
  estimatedServiceMinutes: number;
};

type Props = {
  overview: ClinicOperationsOverview | null;
  overviewLoading: boolean;
  overviewError: string;
  queue: ClinicOperationsQueue | null;
  queueLoading: boolean;
  queueError: string;
  appointments: ClinicOperationsQueue | null;
  appointmentsLoading: boolean;
  appointmentsError: string;
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
  onBack: () => void;
  onEvent: (event: ClinicOperationsEvent) => void | Promise<void>;
  bookingConfiguration?: QueueDrawerBookingConfiguration | null;
  loadAppointmentDetails: (
    appointmentId: string | number,
  ) => Promise<AppointmentDetailsModel>;
  loadDailyAppointmentReport: () => Promise<AuthoritativeAppointmentReport>;
};

function formatQueueNumber(value: number) {
  return `#${String(value).padStart(2, '0')}`;
}

function formatHour(value: string | null | undefined) {
  if (!value) return '—';
  const [hour, minute] = value.split(':').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)));
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
}

function patientRows(data: ClinicOperationsQueue | null): PatientRow[] {
  return (
    data?.patients.flatMap<PatientRow>((patient) => {
      const status = patient.status === 'CALLED' ? 'NOW SERVING' : patient.status;
      if (
        ![
          'WAITING',
          'NOW SERVING',
          'OUT FOR PROCEDURE',
          'TEMPORARILY ABSENT',
          'COMPLETED',
          'CANCELLED',
        ].includes(status)
      ) {
        return [];
      }
      return [
        {
          id: patient.id,
          queue: formatQueueNumber(patient.queueNumber),
          name: patient.name,
          reference: patient.bookingReference,
          service: patient.serviceNames.join(', ') || '—',
          time: formatTimestamp(patient.enteredAt),
          source: patient.source === 'ONLINE' ? 'Online' : 'Staff-assisted',
          status: status as PatientStatus,
          estimatedServiceMinutes: patient.estimatedServiceMinutes,
        },
      ];
    }) ?? []
  );
}

function OperationalState({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: string;
  empty?: string;
}) {
  if (loading) {
    return (
      <div className="ops-workspace-state" role="status">
        Loading authoritative clinic data…
      </div>
    );
  }
  if (error) {
    return (
      <div className="ops-workspace-state is-error" role="alert">
        <strong>Unable to load clinic data.</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (empty) return <div className="ops-workspace-state">{empty}</div>;
  return null;
}

function Timeline({ operations }: { operations: ClinicOperationsOverview }) {
  return (
    <article className="ops-card ops-timeline">
      <header>
        <h3>Clinic Day Timeline</h3>
      </header>
      {operations.timeline.length ? (
        <ol>
          {operations.timeline.map((event) => (
            <li key={event.id}>
              <time>{formatTimestamp(event.occurredAt)}</time>
              <span>
                <strong>
                  {event.type.replaceAll('_', ' ')}
                  {event.patient
                    ? ` · ${formatQueueNumber(event.patient.queueNumber)} ${event.patient.name}`
                    : ''}
                </strong>
                {event.actorName ? <small>By {event.actorName}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p>No queue events have been recorded for this service date.</p>
      )}
    </article>
  );
}

function OverviewTab({
  operations,
  serviceDate,
  onServiceDateChange,
  goTo,
}: {
  operations: ClinicOperationsOverview;
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
  goTo: (tab: OperationsTab) => void;
}) {
  const hours = operations.schedule
    ? operations.schedule.isOpen
      ? `${formatHour(operations.schedule.opensAt)} – ${formatHour(operations.schedule.closesAt)}`
      : 'Closed'
    : 'Schedule unavailable';
  const dayStatus = operations.clinicDay?.status ?? 'NOT_STARTED';
  return (
    <div className="ops-overview">
      <div className="ops-overview-facts">
        <div><OperationsIcon name="clock" /><span><small>Clinic Hours</small><strong>{hours}</strong></span></div>
        <div><OperationsIcon name="clinic" /><span><small>Clinic Status</small><strong className={dayStatus === 'STARTED' ? 'ops-open' : ''}>{dayStatus.replaceAll('_', ' ')}</strong></span></div>
        <div><OperationsIcon name="users" /><span><small>Patients in Queue</small><strong>{operations.queue.waitingCount}</strong></span></div>
        <ServiceDateControl value={serviceDate} onChange={onServiceDateChange} />
      </div>
      <div className="ops-operating">
        <div><OperationsIcon name="person" /><span><small>Operating Secretary</small><strong>{operations.clinicDay?.operatingSecretary?.name ?? 'Not assigned'}</strong><small>For {formatServiceDate(serviceDate, true)}</small></span></div>
        <div><OperationsIcon name="shield" /><span><small>Clinic</small><strong>{operations.clinic.name ?? 'Unnamed clinic'}</strong><small>{operations.clinic.address || 'Address unavailable'}</small></span></div>
      </div>
      <div className="ops-overview-grid">
        <article className="ops-card ops-mini-queue">
          <header><h3>Queue</h3><button type="button" onClick={() => goTo('queue')}>View Full Queue ›</button></header>
          <label>Now Serving</label>
          <div className="ops-current"><b>{operations.queue.nowServing ? formatQueueNumber(operations.queue.nowServing.queueNumber) : '—'}</b><span><strong>{operations.queue.nowServing?.name ?? 'No patient is being served'}</strong><small>{operations.queue.nowServing?.serviceNames.join(', ') || '—'}</small></span></div>
          <label>Next</label>
          <div className="ops-next"><b>{operations.queue.next ? formatQueueNumber(operations.queue.next.queueNumber) : '—'}</b><strong>{operations.queue.next?.name ?? 'No waiting patient'}</strong><span>{operations.queue.next?.serviceNames.join(', ') || '—'}</span></div>
        </article>
        <div className="ops-overview-side">
          <article className="ops-card ops-appointment-glance">
            <header><h3>Appointments</h3><button type="button" onClick={() => goTo('appointments')}>View All ›</button></header>
            <div><OperationsIcon name="calendar" /><strong>{operations.appointments.total} <small>appointments</small></strong><ul><li>Waiting <b>{operations.appointments.counts.WAITING ?? 0}</b></li><li>Now Serving <b>{operations.appointments.counts.CALLED ?? 0}</b></li><li>Completed <b>{operations.appointments.counts.COMPLETED ?? 0}</b></li><li>Cancelled <b>{operations.appointments.counts.CANCELLED ?? 0}</b></li></ul></div>
          </article>
          <Timeline operations={operations} />
        </div>
      </div>
    </div>
  );
}

function QueueTab({
  data,
  serviceDate,
  onServiceDateChange,
  onEvent,
  bookingConfiguration,
  onNotice,
}: {
  data: ClinicOperationsQueue;
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
  onEvent: (event: ClinicOperationsEvent) => void | Promise<void>;
  bookingConfiguration?: QueueDrawerBookingConfiguration | null;
  onNotice: (message: string) => void;
}) {
  const rows = useMemo(() => patientRows(data), [data]);
  const current = rows.find((row) => row.status === 'NOW SERVING');
  const next = rows.find((row) => row.status === 'WAITING');
  const waiting = rows.filter((row) => row.status === 'WAITING');
  const absent = rows.filter((row) => row.status === 'TEMPORARILY ABSENT');
  const procedure = rows.filter((row) => row.status === 'OUT FOR PROCEDURE');
  const [drawer, setDrawer] = useState<QueueDrawerMode | null>(null);
  const [patientOutcome, setPatientOutcome] = useState<'COMPLETED' | 'OUT_FOR_PROCEDURE' | 'NOW_SERVING'>('COMPLETED');

  function handleDrawerCommand(command: QueueDrawerCommand) {
    if (command.type === 'STAFF_REINSERT') return onEvent({ type: 'STAFF_REINSERT', patientId: command.appointmentId, afterPatientId: command.afterAppointmentId });
    if (command.type === 'UNDO_QUEUE') return onEvent({ type: 'UNDO_QUEUE' });
    if (command.type === 'WALK_IN') return onEvent({ type: 'ADD_WALK_IN', firstName: command.firstName, lastName: command.lastName, mobileNumber: command.mobileNumber, existingPatientResponse: command.existingPatientResponse, selectedServiceIds: command.selectedServiceIds, answers: command.answers });
    return onEvent({ type: 'OPERATIONAL_NOTICE', kind: command.kind, reason: command.reason, message: command.message, expectedResumeAt: command.expectedResumeAt });
  }

  return (
    <div className="ops-queue">
      <div className="ops-summary-strip">
        <ServiceDateControl compact value={serviceDate} onChange={onServiceDateChange} />
        <div><OperationsIcon name="clock" /><span><small>Clinic Hours</small><strong>{data.schedule?.isOpen ? `${formatHour(data.schedule.opensAt)} – ${formatHour(data.schedule.closesAt)}` : 'Closed'}</strong></span></div>
        <div><OperationsIcon name="clinic" /><span><small>Clinic Status</small><strong>{data.clinicDay?.status?.replaceAll('_', ' ') ?? 'NOT STARTED'}</strong></span></div>
        <div><OperationsIcon name="users" /><span><small>Patients in Queue</small><strong>{waiting.length}</strong></span></div>
        <div><OperationsIcon name="person" /><span><small>Operating Secretary</small><strong>{data.clinicDay?.operatingSecretary?.name ?? 'Not assigned'}</strong></span></div>
        <div><OperationsIcon name="clock" /><span><small>Started At</small><strong>{formatTimestamp(data.clinicDay?.startedAt)}</strong></span></div>
      </div>
      <div className="ops-queue-layout">
        <aside>
          <article className="ops-card ops-serving"><label>NOW SERVING</label>{current ? <div><b>{current.queue}</b><span><strong>{current.name}</strong><small>{current.service}</small><small>Est. service: {current.estimatedServiceMinutes} min</small></span></div> : <p>No patient is being served.</p>}{current ? <><button type="button" className="ops-action is-green" onClick={() => setPatientOutcome('COMPLETED')}>COMPLETE</button><button type="button" className="ops-action is-orange" onClick={() => setPatientOutcome('OUT_FOR_PROCEDURE')}>OUT FOR PROCEDURE</button><button type="button" className="ops-action is-outline" onClick={() => setPatientOutcome('NOW_SERVING')}>DID NOT RESPOND</button></> : null}</article>
          <article className="ops-card ops-next-card"><label>NEXT</label>{next ? <div><b>{next.queue}</b><span><strong>{next.name}</strong><small>{next.service}</small></span></div> : <p>No waiting patient.</p>}</article>
          <article className="ops-card ops-wait-count"><label>WAITING</label><strong>{waiting.length}</strong></article>
        </aside>
        <main>
          <article className="ops-card ops-waiting-list"><h3>WAITING LIST ({waiting.length})</h3><div className="ops-table-head"><span>Queue #</span><span>Patient</span><span>Service</span><span>Waiting Since</span><span>Est. Service</span><span>Status</span></div>{waiting.map((row) => <div className="ops-table-row" key={row.id}><b>{row.queue}</b><strong>{row.name}</strong><span>{row.service}</span><span>{row.time}</span><span>{row.estimatedServiceMinutes} min</span><span>{row.status}</span></div>)}{!waiting.length ? <p>No patients are currently waiting.</p> : null}</article>
          <div className="ops-exception-grid"><article className="ops-card"><h3>TEMPORARILY ABSENT ({absent.length})</h3>{absent.map((row) => <div className="ops-exception" key={row.id}><b>{row.queue}</b><span><strong>{row.name}</strong><small>{row.service}</small></span><button type="button" onClick={() => onEvent({ type: 'RETURN_TO_QUEUE', patientId: row.id })}>RETURN TO QUEUE</button></div>)}</article><article className="ops-card"><h3>OUT FOR PROCEDURE ({procedure.length})</h3>{procedure.map((row) => <div className="ops-exception" key={row.id}><b>{row.queue}</b><span><strong>{row.name}</strong><small>{row.service}</small></span><button type="button" onClick={() => onEvent({ type: 'RETURN_TO_QUEUE', patientId: row.id })}>RETURN TO QUEUE</button></div>)}</article></div>
        </main>
        <aside className="ops-queue-right"><article className="ops-card"><h3>QUEUE SUMMARY</h3><ul className="ops-summary-list"><li>Waiting <b>{data.counts.WAITING ?? 0}</b></li><li>Now Serving <b>{data.counts.CALLED ?? 0}</b></li><li>Out for Procedure <b>{data.counts.OUT_FOR_PROCEDURE ?? 0}</b></li><li>Temporarily Absent <b>{data.counts.TEMPORARILY_ABSENT ?? 0}</b></li><li>Completed <b>{data.counts.COMPLETED ?? 0}</b></li><li>Cancelled <b>{data.counts.CANCELLED ?? 0}</b></li></ul></article></aside>
      </div>
      <div className="ops-action-bar"><button type="button" className="ops-action is-blue" onClick={() => setDrawer('walkin')}>ADD WALK-IN</button><button type="button" className="ops-action is-green" disabled={!next} onClick={() => next && onEvent({ type: 'CALL_NEXT', patientId: next.id, patientOutcome })}>CALL NEXT</button><button type="button" className="ops-action is-outline" onClick={() => setDrawer('adjust')}>ADJUST QUEUE</button><button type="button" className="ops-action is-orange" onClick={() => setDrawer('delay')}>DELAY / BREAK</button></div>
      {drawer ? <QueueActionDrawer mode={drawer} onClose={() => setDrawer(null)} onComplete={onNotice} patients={rows.map(({ id, queue, name, service, status }) => ({ id, queue, name, service, status }))} onQueueCommand={handleDrawerCommand} bookingConfiguration={bookingConfiguration} serviceDate={serviceDate} onRequestWalkIn={() => setDrawer('walkin')} /> : null}
    </div>
  );
}

function AppointmentsTab({
  data,
  serviceDate,
  onServiceDateChange,
  loadAppointmentDetails,
  loadDailyAppointmentReport,
}: {
  data: ClinicOperationsQueue;
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
  loadAppointmentDetails: (appointmentId: string | number) => Promise<AppointmentDetailsModel>;
  loadDailyAppointmentReport: () => Promise<AuthoritativeAppointmentReport>;
}) {
  const rows = useMemo(() => patientRows(data), [data]);
  const [filter, setFilter] = useState('ALL');
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentDetailsModel | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [report, setReport] = useState<AuthoritativeAppointmentReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const filtered = filter === 'ALL' ? rows : rows.filter((row) => row.status === filter);

  async function openDailyReport() {
    setReportLoading(true);
    setDetailsError('');
    try {
      setReport(await loadDailyAppointmentReport());
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Unable to load the appointment report.');
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <div className="ops-appointments">
      <div className="ops-appointment-toolbar">
        <ServiceDateControl value={serviceDate} onChange={onServiceDateChange} />
        <div><OperationsIcon name="clock" /><span><small>Clinic Hours</small><strong>{data.schedule?.isOpen ? `${formatHour(data.schedule.opensAt)} – ${formatHour(data.schedule.closesAt)}` : 'Closed'}</strong></span></div>
        <div><OperationsIcon name="calendar" /><span><small>Total Appointments</small><strong>{rows.length}</strong></span></div>
        <label>Status Filter<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">All</option><option value="WAITING">Waiting</option><option value="NOW SERVING">Now Serving</option><option value="OUT FOR PROCEDURE">Out for Procedure</option><option value="TEMPORARILY ABSENT">Temporarily Absent</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
      </div>
      <div className="ops-appointment-layout">
        <article className="ops-card ops-appointment-table"><header><h3>Appointments for {formatServiceDate(serviceDate, true)} <small>({filtered.length})</small></h3></header><div className="ops-appt-head"><span>Queue #</span><span>Patient</span><span>Service(s)</span><span>Source</span><span>Status</span><span>View</span></div>{filtered.map((row) => <div className="ops-appt-row" key={row.id}><b>{row.queue}</b><span><strong>{row.name}</strong><small>{row.reference}</small></span><span><strong>{row.service}</strong></span><span>{row.source}</span><span>{row.status}</span><button type="button" aria-label={`View ${row.name}`} onClick={() => { setDetailsLoading(true); setDetailsError(''); void loadAppointmentDetails(row.id).then(setSelectedAppointment).catch((error: unknown) => setDetailsError(error instanceof Error ? error.message : 'Unable to load appointment details.')).finally(() => setDetailsLoading(false)); }}><OperationsIcon name="eye" size={18} /></button></div>)}{!filtered.length ? <p>No appointments match this service date and filter.</p> : null}</article>
        <aside>
          <article className="ops-card"><h3>Appointment Summary</h3><ul className="ops-summary-list"><li>Waiting <b>{data.counts.WAITING ?? 0}</b></li><li>Now Serving <b>{data.counts.CALLED ?? 0}</b></li><li>Out for Procedure <b>{data.counts.OUT_FOR_PROCEDURE ?? 0}</b></li><li>Temporarily Absent <b>{data.counts.TEMPORARILY_ABSENT ?? 0}</b></li><li>Completed <b>{data.counts.COMPLETED ?? 0}</b></li><li>Cancelled <b>{data.counts.CANCELLED ?? 0}</b></li></ul></article>
          <article className="ops-card ops-pdf"><h3>Print / Save PDF</h3><p>Generate the authorized service-date appointment report. No CSV or spreadsheet format is provided.</p><button type="button" className="ops-action is-blue" onClick={() => void openDailyReport()} disabled={reportLoading}>{reportLoading ? 'LOADING REPORT…' : 'GENERATE PDF'}</button></article>
        </aside>
      </div>
      {detailsLoading ? <div className="ops-workspace-state" role="status">Loading appointment details…</div> : null}
      {detailsError ? <div className="ops-workspace-state is-error" role="alert">{detailsError}</div> : null}
      {selectedAppointment ? <AppointmentDetailsDrawer appointment={selectedAppointment} onClose={() => setSelectedAppointment(null)} onReport={() => setDetailsError('Single-appointment PDF reporting is not part of this service-date reporting checkpoint.')} /> : null}
      {report ? <AuthoritativeAppointmentReportPreview report={report} onClose={() => setReport(null)} /> : null}
    </div>
  );
}

export function AuthoritativeClinicOperationsWorkspace({
  overview,
  overviewLoading,
  overviewError,
  queue,
  queueLoading,
  queueError,
  appointments,
  appointmentsLoading,
  appointmentsError,
  serviceDate,
  onServiceDateChange,
  onBack,
  onEvent,
  bookingConfiguration,
  loadAppointmentDetails,
  loadDailyAppointmentReport,
}: Props) {
  const [tab, setTab] = useState<OperationsTab>('overview');
  const [notice, setNotice] = useState('');
  const clinicName = overview?.clinic.name ?? queue?.clinic.name ?? appointments?.clinic.name ?? 'Clinic';
  const clinicId = overview?.clinic.id ?? queue?.clinic.id ?? appointments?.clinic.id ?? null;
  const doctorName = overview?.clinic.doctorName ?? queue?.clinic.doctorName ?? appointments?.clinic.doctorName ?? '';

  async function handleEvent(event: ClinicOperationsEvent) {
    try {
      await onEvent(event);
      if (event.type === 'CALL_NEXT') setNotice('Queue updated from the authoritative clinic command.');
      else if (event.type === 'RETURN_TO_QUEUE' || event.type === 'STAFF_REINSERT') setNotice('Queue placement updated.');
      else if (event.type === 'UNDO_QUEUE') setNotice('The latest eligible queue action was corrected.');
      else if (event.type === 'ADD_WALK_IN') setNotice('Walk-in appointment created.');
      else if (event.type === 'OPERATIONAL_NOTICE') setNotice('Operational notice published.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to update clinic operations.');
    }
  }

  return (
    <section className="clinic-operations-page">
      <button className="clinic-operations-back" type="button" onClick={onBack}>← Back to Clinics</button>
      <div className="clinic-operations-heading"><div><h1>{tab === 'overview' ? clinicName : tab.charAt(0).toUpperCase() + tab.slice(1)}</h1><p>{clinicName}{doctorName ? ` • ${doctorName}` : ''}</p></div></div>
      <nav className="ops-tabs" aria-label="Clinic operations"><button className={tab === 'overview' ? 'is-active' : ''} onClick={() => setTab('overview')}>Overview</button><button className={tab === 'queue' ? 'is-active' : ''} onClick={() => setTab('queue')}>Queue</button><button className={tab === 'appointments' ? 'is-active' : ''} onClick={() => setTab('appointments')}>Appointments</button><button className={tab === 'staff' ? 'is-active' : ''} onClick={() => setTab('staff')}>Staff</button></nav>
      {notice ? <div className="clinic-local-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div> : null}
      {tab === 'overview' ? overview ? <OverviewTab operations={overview} serviceDate={serviceDate} onServiceDateChange={onServiceDateChange} goTo={setTab} /> : <OperationalState loading={overviewLoading} error={overviewError} empty="No operational overview is available for this clinic." /> : null}
      {tab === 'queue' ? queue ? <QueueTab data={queue} serviceDate={serviceDate} onServiceDateChange={onServiceDateChange} onEvent={handleEvent} bookingConfiguration={bookingConfiguration} onNotice={setNotice} /> : <OperationalState loading={queueLoading} error={queueError} empty="No queue data is available for this service date." /> : null}
      {tab === 'appointments' ? appointments ? <AppointmentsTab data={appointments} serviceDate={serviceDate} onServiceDateChange={onServiceDateChange} loadAppointmentDetails={loadAppointmentDetails} loadDailyAppointmentReport={loadDailyAppointmentReport} /> : <OperationalState loading={appointmentsLoading} error={appointmentsError} empty="No appointment data is available for this service date." /> : null}
      {tab === 'staff' ? clinicId ? <AuthoritativeClinicStaffTab clinicId={clinicId} /> : <OperationalState loading={false} error="" empty="No clinic identifier is available for staff data." /> : null}
      <footer className="ops-scope-note">{overview ? `${overview.clinic.address || 'Address unavailable'} · ${overview.clinic.timeZone ?? 'Timezone unavailable'} · ${overview.queue.waitingCount} patients waiting` : 'Operational data is shown only when returned by the backend.'}</footer>
    </section>
  );
}
