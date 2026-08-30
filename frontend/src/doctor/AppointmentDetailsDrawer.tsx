import { OperationsIcon, type OperationsIconName } from './OperationsIcon';

export type AppointmentDetailsModel = {
  id?: string | number;
  queue: string;
  name: string;
  reference: string;
  service: string;
  source: string;
  status: string;
  mobileNumber?: string | null;
  serviceDate?: string;
  estimatedServiceMinutes?: number;
  createdAt?: string;
  calledAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  services?: Array<{ id: string; name: string; durationMinutes: number }>;
  answers?: Array<{
    questionId: string;
    question: string;
    answer: string | null;
  }>;
  history?: Array<{
    id: string;
    type: string;
    occurredAt: string;
    actorName: string;
    actorRole: string;
  }>;
};

type DetailsProps = {
  appointment: AppointmentDetailsModel;
  onClose: () => void;
  onReport: () => void;
};

export function AppointmentDetailsDrawer({
  appointment,
  onClose,
  onReport,
}: DetailsProps) {
  const time = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(value))
      : '—';
  const date = appointment.serviceDate
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'long',
        timeZone: 'UTC',
      }).format(new Date(appointment.serviceDate))
    : '—';
  const label = (value: string) =>
    value
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  return (
    <aside className="appointment-detail-drawer">
      <header>
        <h2>Appointment Details</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close appointment details"
        >
          ×
        </button>
      </header>
      <div className="appointment-detail-body">
        <section className="appointment-person">
          <span>♙</span>
          <div>
            <h3>
              {appointment.name} <em>{label(appointment.status)}</em>
            </h3>
            <p>
              {appointment.reference} • Queue {appointment.queue}
            </p>
          </div>
        </section>
        <DetailSection icon="♙" title="Patient Information">
          <dl>
            <dt>Full Name</dt>
            <dd>{appointment.name}</dd>
            <dt>Mobile Number</dt>
            <dd>{appointment.mobileNumber ?? 'Unavailable'}</dd>
          </dl>
        </DetailSection>
        <DetailSection icon="▣" title="Appointment Information">
          <dl>
            <dt>Service Date</dt>
            <dd>{date}</dd>
            <dt>Source</dt>
            <dd>{appointment.source}</dd>
            <dt>Booked Service(s)</dt>
            <dd>
              {appointment.services
                ?.map((service) => service.name)
                .join(', ') || appointment.service}
            </dd>
            <dt>Estimated Service Duration</dt>
            <dd>{appointment.estimatedServiceMinutes ?? '—'} min</dd>
          </dl>
        </DetailSection>
        <DetailSection icon="▤" title="Queue Information">
          <dl>
            <dt>Queue Number</dt>
            <dd>{appointment.queue}</dd>
            <dt>Current Status</dt>
            <dd>
              <i /> {label(appointment.status)}
            </dd>
            <dt>Entered Queue</dt>
            <dd>{time(appointment.createdAt)}</dd>
            <dt>Called</dt>
            <dd>{time(appointment.calledAt)}</dd>
            <dt>Completed</dt>
            <dd>{time(appointment.completedAt)}</dd>
            <dt>Cancelled</dt>
            <dd>{time(appointment.cancelledAt)}</dd>
          </dl>
        </DetailSection>
        <DetailSection icon="☑" title="Booking Questions & Answers">
          {appointment.answers?.length ? (
            <ol>
              {appointment.answers.map((answer) => (
                <li key={answer.questionId}>
                  <span>{answer.question}</span>
                  <strong>{answer.answer ?? '—'}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p>No booking answers were recorded.</p>
          )}
        </DetailSection>
        <DetailSection icon="◷" title="Appointment History">
          <div className="appointment-history">
            {appointment.history?.map((item) => (
              <div key={item.id}>
                <time>{time(item.occurredAt)}</time>
                <span>
                  <strong>{label(item.type)}</strong>
                  <small>By {item.actorName}</small>
                </span>
              </div>
            ))}
          </div>
        </DetailSection>
      </div>
      <footer>
        <button className="is-report" type="button" onClick={onReport}>
          ▤ Print / Save PDF
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </footer>
    </aside>
  );
}

function DetailSection({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  const iconMap: Record<string, OperationsIconName> = {
    '♙': 'person',
    '▣': 'calendar',
    '▤': 'clinic',
    '☑': 'check',
    '◷': 'clock',
  };
  return (
    <section className="appointment-detail-section">
      <h3>
        <span>
          <OperationsIcon name={iconMap[icon] ?? 'info'} size={18} />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

const reportPatients: AppointmentDetailsModel[] = [
  {
    queue: '#06',
    name: 'Maria Santos',
    reference: '#APP-0012',
    service: 'General Consultation',
    source: 'Online',
    status: 'NOW SERVING',
  },
  {
    queue: '#07',
    name: 'Pedro Reyes',
    reference: '#APP-0013',
    service: 'Dental Cleaning',
    source: 'Online',
    status: 'WAITING',
  },
  {
    queue: '#08',
    name: 'Anna Garcia',
    reference: '#APP-0014',
    service: 'General Consultation',
    source: 'Staff-assisted',
    status: 'WAITING',
  },
  {
    queue: '#09',
    name: 'Juan Dela Cruz',
    reference: '#APP-0015',
    service: 'Laboratory Test',
    source: 'Online',
    status: 'OUT FOR PROCEDURE',
  },
];

export function AppointmentReportPreview({
  mode,
  appointment,
  appointments,
  onClose,
  onGenerate,
}: {
  mode: 'single' | 'daily';
  appointment?: AppointmentDetailsModel;
  appointments?: AppointmentDetailsModel[];
  onClose: () => void;
  onGenerate: () => void;
}) {
  const patient = appointment ?? reportPatients[0];
  return (
    <div
      className="appointment-report-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'single'
          ? 'Single appointment report preview'
          : 'Daily appointment report preview'
      }
    >
      <div className="appointment-report-shell">
        <header>
          <div>
            <h2>
              {mode === 'single'
                ? 'Single Appointment Report'
                : 'Service Date Appointment Report'}
            </h2>
            <p>Preview before generating the PDF.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report preview"
          >
            ×
          </button>
        </header>
        <article className="appointment-paper">
          <div className="report-brand">
            <span>+</span>
            <div>
              <h2>NORTH CLINIC</h2>
              <p>Dr. Juan Dela Cruz</p>
            </div>
            <section>
              <h3>
                {mode === 'single'
                  ? 'APPOINTMENT REPORT'
                  : 'DAILY APPOINTMENT REPORT'}
              </h3>
              <p>Service Date : {patient.serviceDate ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(patient.serviceDate)) : 'Selected date'}</p>
              <p>Generated : {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</p>
            </section>
          </div>
          {mode === 'single' ? (
            <SingleReport patient={patient} />
          ) : (
            <DailyReport patients={appointments ?? reportPatients} />
          )}
          <footer>
            <span>
              ♢ Contains patient information.
              <br /> For authorized clinic use only.
            </span>
            <span>
              Clinic Queueing SaaS
              <br />
              North Clinic · Authorized clinic use.
            </span>
          </footer>
        </article>
        <div className="appointment-report-actions">
          <button type="button" onClick={onClose}>
            Back
          </button>
          <button className="is-primary" type="button" onClick={onGenerate}>
            ▤ Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function SingleReport({ patient }: { patient: AppointmentDetailsModel }) {
  return (
    <div className="single-report-grid">
      <ReportBox title="♙ PATIENT INFORMATION">
        <dl>
          <dt>Full Name</dt>
          <dd>{patient.name}</dd>
          <dt>Mobile Number</dt>
          <dd>{patient.mobileNumber ?? 'Unavailable'}</dd>
        </dl>
      </ReportBox>
      <ReportBox title="▣ APPOINTMENT INFORMATION">
        <dl>
          <dt>Appointment Reference</dt>
          <dd>{patient.reference}</dd>
          <dt>Queue Number</dt>
          <dd>{patient.queue}</dd>
          <dt>Current Status</dt>
          <dd className="is-green">{patient.status}</dd>
          <dt>Source</dt>
          <dd>{patient.source}</dd>
          <dt>Booked Date</dt>
          <dd>{patient.createdAt ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(patient.createdAt)) : '—'}</dd>
        </dl>
      </ReportBox>
      <ReportBox title="▤ BOOKED SERVICES">
        <div className="report-service">
          <span>Service</span>
          <span>Estimated Duration</span>
          <strong>{patient.service}</strong>
          <strong>{patient.estimatedServiceMinutes ?? '—'} minutes</strong>
        </div>
        <p>Total Estimated Service Duration: {patient.estimatedServiceMinutes ?? '—'} minutes</p>
      </ReportBox>
      <ReportBox wide title="▱ BOOKING QUESTIONS & ANSWERS">
        {patient.answers?.length ? <ol>{patient.answers.map((answer) => <li key={answer.questionId}>{answer.question} <strong>{answer.answer ?? '—'}</strong></li>)}</ol> : <p>No booking answers were recorded.</p>}
      </ReportBox>
      <ReportBox wide title="◷ APPOINTMENT HISTORY">
        <div className="report-history"><strong>Date & Time</strong><strong>Event</strong><strong>By</strong>{patient.history?.map((item) => <><span key={`${item.id}-time`}>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.occurredAt))}</span><span key={`${item.id}-event`}>{item.type.replaceAll('_', ' ')}</span><span key={`${item.id}-actor`}>{item.actorName}</span></>)}</div>
      </ReportBox>
    </div>
  );
}

function DailyReport({ patients }: { patients: AppointmentDetailsModel[] }) {
  const summary = patients.reduce<Record<string, number>>((counts, patient) => {
    counts[patient.status] = (counts[patient.status] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <>
      <div className="daily-report-summary">
        <p>
          Clinic Hours: <strong>8:00 AM – 5:00 PM</strong>
          <br />
          Total Appointments: <strong>{patients.length}</strong>
        </p>
        {Object.entries(summary).map(([label, count]) => (
          <div key={label}>
            <strong>{count}</strong>
            <small>{label}</small>
          </div>
        ))}
      </div>
      <div className="daily-report-patients">
        {patients.map((patient) => (
          <section key={patient.queue}>
            <b>{patient.queue}</b>
            <div>
              <strong>{patient.name}</strong>
              <small>Mobile: {patient.mobileNumber ?? 'Unavailable'}</small>
            </div>
            <div>
              <small>Service(s):</small>
              <strong>• {patient.service}</strong>
              <small>(Est. {patient.estimatedServiceMinutes ?? '—'} min)</small>
            </div>
            <div>
              <small>Status:</small>
              <em>{patient.status}</em>
              <small>
                {patient.status === 'NOW SERVING'
                  ? `Called: ${patient.calledAt ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(patient.calledAt)) : '—'}`
                  : ''}
              </small>
            </div>
            <div>
              <small>Booking Questions</small>
              {patient.answers?.length ? patient.answers.slice(0, 4).map((answer) => <span key={answer.questionId}>• {answer.question}: {answer.answer ?? '—'}</span>) : <span>None recorded</span>}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function ReportBox({
  title,
  children,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`report-box${wide ? ' is-wide' : ''}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
