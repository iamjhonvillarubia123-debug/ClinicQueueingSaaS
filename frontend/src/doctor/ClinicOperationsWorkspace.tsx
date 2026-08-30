import { useMemo, useState } from 'react';
import { QueueActionDrawer, type QueueDrawerMode } from './QueueActionDrawer';
import {
  AppointmentDetailsDrawer,
  AppointmentReportPreview,
} from './AppointmentDetailsDrawer';
import { ServiceDateControl, formatServiceDate } from './ServiceDateControl';
import { OperationsIcon, type OperationsIconName } from './OperationsIcon';

type OperationsTab = 'overview' | 'queue' | 'appointments' | 'staff';
type ServiceDateProps = {
  serviceDate: string;
  onServiceDateChange: (value: string) => void;
};
type PatientStatus =
  | 'WAITING'
  | 'NOW SERVING'
  | 'OUT FOR PROCEDURE'
  | 'TEMPORARILY ABSENT'
  | 'COMPLETED'
  | 'CANCELLED';

export type ClinicOperationsEvent =
  | { type: 'CALL_NEXT'; patientId: string | number }
  | { type: 'COMPLETE_CURRENT'; patientId: string | number }
  | { type: 'RETURN_TO_QUEUE'; patientId: string | number }
  | { type: 'OPEN_ASSIGN_SECRETARY' }
  | { type: 'GENERATE_PDF' }
  | { type: 'PLACEHOLDER_ACTION'; label: string };

type Patient = {
  id: string | number;
  queue: string;
  name: string;
  reference: string;
  service: string;
  time: string;
  source: 'Online' | 'Staff-assisted';
  status: PatientStatus;
};
type StaffMember = {
  initials: string;
  name: string;
  email: string;
  phone: string;
  status: 'Active' | 'Pending';
  assigned: string;
};
type OperationsQueuePatient = {
  id: string;
  bookingReference: string;
  queueNumber: number;
  name: string;
  status: string;
  estimatedServiceMinutes: number;
  serviceNames: string[];
  enteredAt: string;
  calledAt: string | null;
  completedAt: string | null;
};
export type ClinicOperationsOverview = {
  clinic: {
    id: string;
    name: string | null;
    address: string;
    countryCode: string | null;
    timeZone: string | null;
    lifecycleStatus: string;
    doctorName: string;
  };
  serviceDate: string;
  schedule: {
    isOpen: boolean;
    opensAt: string | null;
    closesAt: string | null;
  } | null;
  clinicDay: {
    id: string;
    status: string;
    openingOverrideAt: string | null;
    startedAt: string | null;
    closedAt: string | null;
    operatingSecretary: {
      practiceStaffId: string;
      userId: string;
      name: string;
    } | null;
  } | null;
  queue: {
    counts: Record<string, number>;
    waitingCount: number;
    nowServing: OperationsQueuePatient | null;
    next: OperationsQueuePatient | null;
    waitingPreview: OperationsQueuePatient[];
  };
  appointments: { total: number; counts: Record<string, number> };
  timeline: Array<{
    id: string;
    type: string;
    occurredAt: string;
    actorName: string | null;
    patient: { queueNumber: number; name: string } | null;
  }>;
};
export type ClinicOperationsQueue = {
  clinic: ClinicOperationsOverview['clinic'];
  serviceDate: string;
  schedule: ClinicOperationsOverview['schedule'];
  clinicDay: ClinicOperationsOverview['clinicDay'];
  counts: Record<string, number>;
  patients: Array<
    OperationsQueuePatient & {
      source: 'ONLINE' | 'STAFF_ASSISTED';
      waitingPlacementType: string | null;
      servingOrderKey: string | null;
    }
  >;
  timeline: ClinicOperationsOverview['timeline'];
};

const initialPatients: Patient[] = [
  {
    id: 6,
    queue: '#06',
    name: 'Maria Santos',
    reference: '#APP-0012',
    service: 'General Consultation',
    time: '9:15 AM',
    source: 'Online',
    status: 'NOW SERVING',
  },
  {
    id: 7,
    queue: '#07',
    name: 'Pedro Reyes',
    reference: '#APP-0013',
    service: 'Dental Cleaning',
    time: '9:20 AM',
    source: 'Online',
    status: 'WAITING',
  },
  {
    id: 8,
    queue: '#08',
    name: 'Anna Garcia',
    reference: '#APP-0014',
    service: 'General Consultation',
    time: '9:28 AM',
    source: 'Staff-assisted',
    status: 'WAITING',
  },
  {
    id: 9,
    queue: '#09',
    name: 'Juan Dela Cruz',
    reference: '#APP-0015',
    service: 'Laboratory Test',
    time: '9:30 AM',
    source: 'Online',
    status: 'OUT FOR PROCEDURE',
  },
  {
    id: 10,
    queue: '#10',
    name: 'Liza Morales',
    reference: '#APP-0016',
    service: 'General Consultation',
    time: '9:35 AM',
    source: 'Online',
    status: 'TEMPORARILY ABSENT',
  },
  {
    id: 11,
    queue: '#11',
    name: 'Ramona Bautista',
    reference: '#APP-0017',
    service: 'X-Ray',
    time: '9:42 AM',
    source: 'Staff-assisted',
    status: 'COMPLETED',
  },
  {
    id: 12,
    queue: '#12',
    name: 'Sofia Lim',
    reference: '#APP-0018',
    service: 'General Consultation',
    time: '9:50 AM',
    source: 'Online',
    status: 'COMPLETED',
  },
  {
    id: 13,
    queue: '#13',
    name: 'Carlos Tan',
    reference: '#APP-0019',
    service: 'General Consultation',
    time: '9:55 AM',
    source: 'Online',
    status: 'CANCELLED',
  },
  {
    id: 14,
    queue: '#14',
    name: 'Angela Reyes',
    reference: '#APP-0020',
    service: 'General Consultation',
    time: '9:55 AM',
    source: 'Online',
    status: 'WAITING',
  },
  {
    id: 15,
    queue: '#15',
    name: 'Ramon Bautista',
    reference: '#APP-0021',
    service: 'X-Ray',
    time: '10:05 AM',
    source: 'Staff-assisted',
    status: 'WAITING',
  },
  {
    id: 16,
    queue: '#16',
    name: 'Elena Flores',
    reference: '#APP-0022',
    service: 'Dental Cleaning',
    time: '10:12 AM',
    source: 'Online',
    status: 'WAITING',
  },
  {
    id: 17,
    queue: '#17',
    name: 'Marco Villanueva',
    reference: '#APP-0023',
    service: 'General Consultation',
    time: '10:20 AM',
    source: 'Online',
    status: 'WAITING',
  },
];

const initialStaff: StaffMember[] = [
  {
    initials: 'MS',
    name: 'Maria Santos',
    email: 'maria.santos@example.com',
    phone: '0917 111 2222',
    status: 'Active',
    assigned: 'May 20, 2026 · 8:45 AM',
  },
  {
    initials: 'JR',
    name: 'Jane Reyes',
    email: 'jane.reyes@example.com',
    phone: '0918 333 4444',
    status: 'Active',
    assigned: 'May 21, 2026 · 10:15 AM',
  },
];

const legacyIconMap: Record<string, OperationsIconName> = {
  '◷': 'clock',
  '▣': 'calendar',
  '▤': 'clinic',
  '♧': 'users',
  '♙': 'person',
  '♢': 'shield',
  '✉': 'mail',
};
function Icon({ children }: { children: string }) {
  return (
    <span className="ops-icon" aria-hidden="true">
      <OperationsIcon name={legacyIconMap[children] ?? 'info'} />
    </span>
  );
}
function ActionButton({
  children,
  onClick,
  variant = 'outline',
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'outline' | 'solid' | 'blue' | 'green' | 'orange';
}) {
  return (
    <button
      className={`ops-action is-${variant}`}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function StatusPill({ status }: { status: PatientStatus }) {
  return (
    <span
      className={`ops-status is-${status.toLowerCase().replaceAll(' ', '-')}`}
    >
      {status}
    </span>
  );
}
function ActionLabel({
  icon,
  children,
}: {
  icon: OperationsIconName;
  children: React.ReactNode;
}) {
  return (
    <span className="ops-action-label">
      <OperationsIcon name={icon} size={20} />
      {children}
    </span>
  );
}
function SummaryItem({
  tone,
  label,
  value,
  icon,
}: {
  tone: string;
  label: string;
  value: React.ReactNode;
  icon?: OperationsIconName;
}) {
  return (
    <li>
      <span className={`ops-summary-label is-${tone}`}>
        <i>{icon ? <OperationsIcon name={icon} size={13} /> : null}</i>
        {label}
      </span>
      <b>{value}</b>
    </li>
  );
}
function formatQueueNumber(value: number | undefined) {
  return value === undefined ? '—' : `#${String(value).padStart(2, '0')}`;
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

function SummaryStrip({
  waiting,
  serviceDate,
  onServiceDateChange,
}: { waiting: number } & ServiceDateProps) {
  return (
    <div className="ops-summary-strip">
      <ServiceDateControl
        compact
        value={serviceDate}
        onChange={onServiceDateChange}
      />
      <div>
        <Icon>◷</Icon>
        <span>
          <small>Clinic Hours</small>
          <strong>8:00 AM – 5:00 PM</strong>
        </span>
      </div>
      <div>
        <Icon>▤</Icon>
        <span>
          <small>Clinic Status</small>
          <strong className="ops-open">Open</strong>
          <small>Clinic is running</small>
        </span>
      </div>
      <div>
        <Icon>♧</Icon>
        <span>
          <small>Patients in Queue</small>
          <strong>{waiting}</strong>
          <small>Actively in the queue</small>
        </span>
      </div>
      <div>
        <Icon>♙</Icon>
        <span>
          <small>Operating Secretary</small>
          <strong>Maria Santos</strong>
          <a href="#ops-staff">Change Secretary</a>
        </span>
      </div>
      <div>
        <Icon>◷</Icon>
        <span>
          <small>Started At</small>
          <strong>8:00 AM</strong>
          <small>Today</small>
        </span>
      </div>
    </div>
  );
}
function Timeline() {
  return (
    <article className="ops-card ops-timeline">
      <header>
        <h3>Clinic Day Timeline</h3>
        <button>View Full Timeline</button>
      </header>
      <ol>
        <li>
          <time>8:00 AM</time>
          <span>
            <strong>Clinic started</strong>
            <small>By Maria Santos</small>
          </span>
        </li>
        <li>
          <time>9:15 AM</time>
          <span>
            <strong>Now serving #06 Maria Santos</strong>
          </span>
        </li>
        <li>
          <time>10:02 AM</time>
          <span>
            <strong>#05 completed</strong>
            <small>Sofia Lim</small>
          </span>
        </li>
        <li className="is-orange">
          <time>10:28 AM</time>
          <span>
            <strong>#04 temporarily absent</strong>
            <small>Carlos Tan</small>
          </span>
        </li>
        <li className="is-purple">
          <time>10:35 AM</time>
          <span>
            <strong>#02 returned from procedure</strong>
            <small>Juan Dela Cruz</small>
          </span>
        </li>
      </ol>
      <footer>↻ Last updated: 10:35 AM</footer>
    </article>
  );
}

function OverviewTab({
  operations,
  goTo,
  serviceDate,
  onServiceDateChange,
}: {
  operations: ClinicOperationsOverview;
  goTo: (tab: OperationsTab) => void;
} & ServiceDateProps) {
  const hours = operations.schedule?.isOpen
    ? `${formatHour(operations.schedule.opensAt)} – ${formatHour(operations.schedule.closesAt)}`
    : 'Closed';
  const dayStatus = operations.clinicDay?.status ?? 'NOT_STARTED';
  const current = operations.queue.nowServing;
  const next = operations.queue.next;
  return (
    <div className="ops-overview">
      <div className="ops-overview-facts">
        <div>
          <Icon>◷</Icon>
          <span>
            <small>Today’s Clinic Hours</small>
            <strong>{hours}</strong>
          </span>
        </div>
        <div>
          <Icon>▤</Icon>
          <span>
            <small>Clinic Status</small>
            <strong className={dayStatus === 'STARTED' ? 'ops-open' : ''}>
              {dayStatus.replaceAll('_', ' ')}
            </strong>
            <small>
              {dayStatus === 'STARTED'
                ? 'Clinic day is in progress'
                : 'For the selected service date'}
            </small>
          </span>
        </div>
        <div>
          <Icon>♧</Icon>
          <span>
            <small>Patients in Queue</small>
            <strong>{operations.queue.waitingCount}</strong>
            <small>Actively waiting</small>
          </span>
        </div>
        <ServiceDateControl
          value={serviceDate}
          onChange={onServiceDateChange}
        />
      </div>
      <div className="ops-operating">
        <div>
          <Icon>♙</Icon>
          <span>
            <small>Operating Secretary</small>
            <strong>
              {operations.clinicDay?.operatingSecretary?.name ?? 'Not assigned'}{' '}
              <em>For {formatServiceDate(serviceDate, true)}</em>
            </strong>
            <small>
              {operations.clinicDay?.operatingSecretary
                ? 'Managing clinic operations'
                : 'No operating secretary assigned'}
            </small>
          </span>
        </div>
        <div>
          <Icon>♢</Icon>
          <span>
            <small>Clinic</small>
            <strong>{operations.clinic.name ?? 'Unnamed clinic'}</strong>
            <small>All actions are specific to this clinic</small>
          </span>
        </div>
      </div>
      <div className="ops-overview-grid">
        <article className="ops-card ops-mini-queue">
          <header>
            <h3>
              Today’s Queue{' '}
              <small>({formatServiceDate(serviceDate, true)})</small>
            </h3>
            <button onClick={() => goTo('queue')}>View Full Queue ›</button>
          </header>
          <label>Now Serving</label>
          <div className="ops-current">
            <b>{formatQueueNumber(current?.queueNumber)}</b>
            <span>
              <strong>{current?.name ?? 'No patient is being served'}</strong>
              <small>{current?.serviceNames.join(', ') || '—'}</small>
            </span>
          </div>
          <label>Next</label>
          <div className="ops-next">
            <b>{formatQueueNumber(next?.queueNumber)}</b>
            <strong>{next?.name ?? 'No waiting patient'}</strong>
            <span>{next?.serviceNames.join(', ') || '—'}</span>
            <small>
              {next ? `Est. service: ${next.estimatedServiceMinutes} min` : ''}
            </small>
          </div>
          <label>Waiting ({operations.queue.waitingCount})</label>
          {operations.queue.waitingPreview.map((patient) => (
            <div className="ops-wait-row" key={patient.id}>
              <b>{formatQueueNumber(patient.queueNumber)}</b>
              <strong>{patient.name}</strong>
              <span>{patient.serviceNames.join(', ') || '—'}</span>
            </div>
          ))}
          {operations.queue.waitingCount >
          operations.queue.waitingPreview.length ? (
            <p>
              +{' '}
              {operations.queue.waitingCount -
                operations.queue.waitingPreview.length}{' '}
              more patients
            </p>
          ) : null}
        </article>
        <div className="ops-overview-side">
          <article className="ops-card ops-appointment-glance">
            <header>
              <h3>Appointments Today</h3>
              <button onClick={() => goTo('appointments')}>View All ›</button>
            </header>
            <div>
              <Icon>▣</Icon>
              <strong>
                {operations.appointments.total} <small>appointments</small>
              </strong>
              <ul>
                <li>
                  ● Waiting <b>{operations.appointments.counts.WAITING ?? 0}</b>
                </li>
                <li>
                  ● Now Serving{' '}
                  <b>{operations.appointments.counts.CALLED ?? 0}</b>
                </li>
                <li>
                  ● Completed{' '}
                  <b>{operations.appointments.counts.COMPLETED ?? 0}</b>
                </li>
                <li>
                  ● Cancelled{' '}
                  <b>{operations.appointments.counts.CANCELLED ?? 0}</b>
                </li>
              </ul>
            </div>
          </article>
          <Timeline />
        </div>
      </div>
      <div className="ops-info">
        <OperationsIcon name="info" size={18} />
        <span>
          <strong>
            You are viewing {operations.clinic.name ?? 'this clinic'}.
          </strong>
          <small>All actions and data are specific to this clinic.</small>
        </span>
        <button>
          <ActionLabel icon="swap">Change Clinic</ActionLabel>
        </button>
      </div>
    </div>
  );
}

function QueueTab({
  patients,
  onLocalAction,
  serviceDate,
  onServiceDateChange,
}: {
  patients: Patient[];
  onLocalAction: (event: ClinicOperationsEvent) => void;
} & ServiceDateProps) {
  const [drawer, setDrawer] = useState<QueueDrawerMode | null>(null);
  const current = patients.find((p) => p.status === 'NOW SERVING')!;
  const next = patients.find((p) => p.status === 'WAITING')!;
  const waiting = patients.filter((p) => p.status === 'WAITING');
  const absent = patients.filter((p) => p.status === 'TEMPORARILY ABSENT');
  const procedure = patients.filter((p) => p.status === 'OUT FOR PROCEDURE');
  return (
    <div className="ops-queue">
      <SummaryStrip
        waiting={10}
        serviceDate={serviceDate}
        onServiceDateChange={onServiceDateChange}
      />
      <div className="ops-queue-layout">
        <aside>
          <article className="ops-card ops-serving">
            <label>NOW SERVING</label>
            <button className="ops-more">⋮</button>
            <div>
              <b>{current.queue}</b>
              <span>
                <strong>{current.name}</strong>
                <small>{current.service}</small>
                <small>Since 9:15 AM · Est. service: 15 min</small>
              </span>
            </div>
            <ActionButton
              variant="green"
              onClick={() =>
                onLocalAction({
                  type: 'COMPLETE_CURRENT',
                  patientId: current.id,
                })
              }
            >
              <ActionLabel icon="check">COMPLETE</ActionLabel>
            </ActionButton>
            <ActionButton
              variant="orange"
              onClick={() =>
                onLocalAction({
                  type: 'PLACEHOLDER_ACTION',
                  label: 'Out for procedure',
                })
              }
            >
              <ActionLabel icon="procedure">OUT FOR PROCEDURE</ActionLabel>
            </ActionButton>
            <ActionButton
              onClick={() =>
                onLocalAction({
                  type: 'PLACEHOLDER_ACTION',
                  label: 'Did not respond',
                })
              }
            >
              <ActionLabel icon="person">DID NOT RESPOND</ActionLabel>
            </ActionButton>
          </article>
          <article className="ops-card ops-next-card">
            <label>NEXT</label>
            <div>
              <b>{next.queue}</b>
              <span>
                <strong>{next.name}</strong>
                <small>{next.service}</small>
                <small>Est. service: 5 min</small>
              </span>
            </div>
          </article>
          <article className="ops-card ops-wait-count">
            <label>WAITING</label>
            <strong className="ops-inline-icon">
              <OperationsIcon name="users" />
              {10}
            </strong>
            <small>People waiting after next</small>
          </article>
        </aside>
        <main>
          <article className="ops-card ops-waiting-list">
            <h3>WAITING LIST ({10})</h3>
            <div className="ops-table-head">
              <span>Queue #</span>
              <span>Patient</span>
              <span>Service</span>
              <span>Waiting Since</span>
              <span>Est. Service</span>
              <span>Status</span>
            </div>
            {waiting.map((p) => (
              <div className="ops-table-row" key={p.id}>
                <b>{p.queue}</b>
                <strong>{p.name}</strong>
                <span>{p.service}</span>
                <span>{p.time}</span>
                <span>15 min</span>
                <StatusPill status={p.status} />
              </div>
            ))}
            <a>+ 4 more patients</a>
          </article>
          <div className="ops-exception-grid">
            <article className="ops-card">
              <h3 className="is-orange">
                <ActionLabel icon="person">
                  TEMPORARILY ABSENT ({absent.length})
                </ActionLabel>
              </h3>
              {absent.map((p) => (
                <div className="ops-exception" key={p.id}>
                  <b>{p.queue}</b>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.service}</small>
                    <small>Missed at 9:40 AM</small>
                  </span>
                  <button
                    onClick={() =>
                      onLocalAction({
                        type: 'RETURN_TO_QUEUE',
                        patientId: p.id,
                      })
                    }
                  >
                    RETURN TO QUEUE
                  </button>
                </div>
              ))}
            </article>
            <article className="ops-card">
              <h3 className="is-purple">
                <ActionLabel icon="procedure">
                  OUT FOR PROCEDURE ({procedure.length})
                </ActionLabel>
              </h3>
              {procedure.map((p) => (
                <div className="ops-exception" key={p.id}>
                  <b>{p.queue}</b>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.service}</small>
                    <small>Out since 9:30 AM</small>
                  </span>
                  <button
                    onClick={() =>
                      onLocalAction({
                        type: 'RETURN_TO_QUEUE',
                        patientId: p.id,
                      })
                    }
                  >
                    RETURN TO QUEUE
                  </button>
                </div>
              ))}
            </article>
          </div>
        </main>
        <aside className="ops-queue-right">
          <article className="ops-card">
            <h3>QUEUE SUMMARY</h3>
            <ul className="ops-summary-list">
              <SummaryItem
                tone="blue"
                icon="users"
                label="In Queue (Waiting)"
                value={10}
              />
              <SummaryItem
                tone="green"
                icon="play"
                label="Now Serving"
                value={1}
              />
              <SummaryItem tone="amber" label="Protected Next" value={1} />
              <SummaryItem
                tone="purple"
                icon="procedure"
                label="Out for Procedure"
                value={procedure.length}
              />
              <SummaryItem
                tone="orange"
                icon="person"
                label="Temporarily Absent"
                value={absent.length}
              />
              <SummaryItem
                tone="green"
                icon="check"
                label="Completed Today"
                value={5}
              />
              <SummaryItem
                tone="red"
                icon="close"
                label="Cancelled"
                value={1}
              />
            </ul>
          </article>
          <Timeline />
        </aside>
      </div>
      <div className="ops-action-bar">
        <ActionButton variant="blue" onClick={() => setDrawer('walkin')}>
          <ActionLabel icon="plus">ADD WALK-IN</ActionLabel>
        </ActionButton>
        <ActionButton
          variant="green"
          onClick={() =>
            onLocalAction({ type: 'CALL_NEXT', patientId: next.id })
          }
        >
          <ActionLabel icon="play">CALL NEXT</ActionLabel>
        </ActionButton>
        <ActionButton onClick={() => setDrawer('adjust')}>
          <ActionLabel icon="swap">ADJUST QUEUE</ActionLabel>
        </ActionButton>
        <ActionButton variant="orange" onClick={() => setDrawer('delay')}>
          <ActionLabel icon="coffee">DELAY / BREAK</ActionLabel>
        </ActionButton>
      </div>
      {drawer ? (
        <QueueActionDrawer
          mode={drawer}
          onClose={() => setDrawer(null)}
          onComplete={(message) =>
            onLocalAction({ type: 'PLACEHOLDER_ACTION', label: message })
          }
        />
      ) : null}
    </div>
  );
}

function AppointmentsTab({
  patients,
  onLocalAction,
  serviceDate,
  onServiceDateChange,
}: {
  patients: Patient[];
  onLocalAction: (event: ClinicOperationsEvent) => void;
} & ServiceDateProps) {
  const [selectedAppointment, setSelectedAppointment] =
    useState<Patient | null>(null);
  const [reportMode, setReportMode] = useState<'single' | 'daily' | null>(null);
  const [filter, setFilter] = useState('ALL');
  const filtered =
    filter === 'ALL' ? patients : patients.filter((p) => p.status === filter);
  return (
    <div className="ops-appointments">
      <div className="ops-appointment-toolbar">
        <ServiceDateControl
          value={serviceDate}
          onChange={onServiceDateChange}
        />
        <div>
          <Icon>◷</Icon>
          <span>
            <small>Clinic Hours</small>
            <strong>8:00 AM – 5:00 PM</strong>
          </span>
        </div>
        <div>
          <Icon>♧</Icon>
          <span>
            <small>Total Appointments</small>
            <strong>12</strong>
            <small>All statuses</small>
          </span>
        </div>
        <label>
          Status Filter
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">All</option>
            {(
              [
                'WAITING',
                'NOW SERVING',
                'OUT FOR PROCEDURE',
                'TEMPORARILY ABSENT',
                'COMPLETED',
                'CANCELLED',
              ] as const
            ).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="ops-appointment-layout">
        <article className="ops-card ops-appointment-table">
          <header>
            <h3>
              Appointments for {formatServiceDate(serviceDate, true)}{' '}
              <small>({filtered.length})</small>
            </h3>
            <button>↻ Refresh</button>
          </header>
          <div className="ops-appt-head">
            <span>Queue #</span>
            <span>Patient</span>
            <span>Service(s)</span>
            <span>Source</span>
            <span>Status</span>
            <span>View</span>
          </div>
          {filtered.map((p) => (
            <div className="ops-appt-row" key={p.id}>
              <b>{p.queue}</b>
              <span>
                <strong>{p.name}</strong>
                <small>{p.reference}</small>
              </span>
              <span>
                <strong>{p.service}</strong>
                <small>Dr. Juan Dela Cruz</small>
              </span>
              <span className="ops-source">
                <OperationsIcon
                  name={p.source === 'Online' ? 'globe' : 'person'}
                  size={16}
                />
                {p.source}
              </span>
              <StatusPill status={p.status} />
              <button
                type="button"
                aria-label={`View ${p.name}`}
                onClick={() => setSelectedAppointment(p)}
              >
                <OperationsIcon name="eye" size={18} />
              </button>
            </div>
          ))}
        </article>
        <aside>
          <article className="ops-card">
            <h3>Appointment Summary</h3>
            <ul className="ops-summary-list">
              <SummaryItem
                tone="green"
                icon="play"
                label="Now Serving"
                value={1}
              />
              <SummaryItem tone="blue" label="Waiting" value={2} />
              <SummaryItem
                tone="amber"
                icon="procedure"
                label="Out for Procedure"
                value={1}
              />
              <SummaryItem
                tone="orange"
                icon="person"
                label="Temporarily Absent"
                value={1}
              />
              <SummaryItem
                tone="gray"
                icon="check"
                label="Completed"
                value={2}
              />
              <SummaryItem
                tone="red"
                icon="close"
                label="Cancelled"
                value={1}
              />
            </ul>
          </article>
          <article className="ops-card ops-pdf">
            <h3>Print / Save PDF</h3>
            <p className="ops-inline-icon">
              <OperationsIcon name="print" size={19} />
              Generate a PDF report for the selected service date.
            </p>
            <ul>
              <li>✓ Patient list with queue numbers</li>
              <li>✓ Services booked</li>
              <li>✓ Booking questions and answers</li>
              <li>✓ Current status</li>
            </ul>
            <ActionButton variant="blue" onClick={() => setReportMode('daily')}>
              <ActionLabel icon="print">Generate PDF</ActionLabel>
            </ActionButton>
            <small>
              Reports contain patient information. Ensure you are authorized to
              print or share.
            </small>
          </article>
        </aside>
      </div>
      {selectedAppointment ? (
        <AppointmentDetailsDrawer
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          onReport={() => setReportMode('single')}
        />
      ) : null}
      {reportMode ? (
        <AppointmentReportPreview
          mode={reportMode}
          appointment={selectedAppointment ?? undefined}
          onClose={() => setReportMode(null)}
          onGenerate={() => {
            onLocalAction({ type: 'GENERATE_PDF' });
            setReportMode(null);
          }}
        />
      ) : null}
    </div>
  );
}

function StaffTab({
  onLocalAction,
}: {
  onLocalAction: (event: ClinicOperationsEvent) => void;
}) {
  const [staff, setStaff] = useState(initialStaff);
  const [drawer, setDrawer] = useState(false);
  const [choice, setChoice] = useState<'choose' | 'existing' | 'invite'>(
    'choose',
  );
  const [search, setSearch] = useState('');
  const matching = staff.filter((member) =>
    `${member.name} ${member.email}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  function openDrawer() {
    setDrawer(true);
    setChoice('choose');
    onLocalAction({ type: 'OPEN_ASSIGN_SECRETARY' });
  }
  return (
    <div id="ops-staff" className={`ops-staff ${drawer ? 'has-drawer' : ''}`}>
      <div className="ops-staff-main">
        <div className="ops-staff-heading">
          <div>
            <h2>Staff</h2>
            <p>Manage the secretaries assigned to North Clinic.</p>
          </div>
          <ActionButton variant="solid" onClick={openDrawer}>
            ♧ Assign Secretary
          </ActionButton>
        </div>
        <article className="ops-card ops-staff-list">
          <div className="ops-staff-filters">
            <div>
              <button className="is-active">All ({staff.length})</button>
              <button>
                Active ({staff.filter((s) => s.status === 'Active').length})
              </button>
              <button>Inactive (0)</button>
              <button>
                Pending Invitations (
                {staff.filter((s) => s.status === 'Pending').length})
              </button>
            </div>
            <input
              placeholder="Search secretary by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="ops-staff-head">
            <span>Secretary</span>
            <span>Role at this Clinic</span>
            <span>Status</span>
            <span>Assigned Since</span>
            <span>Actions</span>
          </div>
          {matching.map((member) => (
            <div className="ops-staff-row" key={member.email}>
              <b>{member.initials}</b>
              <span>
                <strong>{member.name}</strong>
                <small>{member.email}</small>
                <small>{member.phone}</small>
              </span>
              <span>Clinic Secretary</span>
              <span className="ops-active-dot">● {member.status}</span>
              <span>{member.assigned}</span>
              <button>⋮</button>
            </div>
          ))}
          <div className="ops-access-summary">
            <div>
              <strong>
                {staff.filter((s) => s.status === 'Active').length}
              </strong>
              <span>Active Secretaries</span>
              <small>Currently assigned</small>
            </div>
            <div>
              <strong>0</strong>
              <span>Inactive Secretaries</span>
              <small>Not currently active</small>
            </div>
            <div>
              <strong>
                {staff.filter((s) => s.status === 'Pending').length}
              </strong>
              <span>Pending Invitations</span>
              <small>Awaiting acceptance</small>
            </div>
          </div>
        </article>
      </div>
      {drawer ? (
        <aside className="ops-assign-drawer">
          <button className="ops-drawer-close" onClick={() => setDrawer(false)}>
            ×
          </button>
          {choice === 'choose' ? (
            <>
              <h3>
                <em>1</em> Choose how to assign a Secretary
              </h3>
              <p>
                Select an option below to assign a secretary to North Clinic.
              </p>
              <button
                className="ops-assign-choice"
                onClick={() => setChoice('existing')}
              >
                <Icon>♧</Icon>
                <span>
                  <strong>Assign Existing Secretary</strong>
                  <small>Choose a secretary who already has an account.</small>
                </span>
                ›
              </button>
              <button
                className="ops-assign-choice"
                onClick={() => setChoice('invite')}
              >
                <Icon>✉</Icon>
                <span>
                  <strong>Invite New Secretary</strong>
                  <small>Invite a new secretary to join Clinic Queueing.</small>
                </span>
                ›
              </button>
            </>
          ) : null}
          {choice === 'existing' ? (
            <>
              <h3>Assign Existing Secretary</h3>
              <input placeholder="Search by name or email…" autoFocus />
              <div className="ops-candidate">
                <b>MS</b>
                <span>
                  <strong>Maria Santos</strong>
                  <small>maria.santos@example.com</small>
                </span>
                <em>Active</em>
              </div>
              <ActionButton
                variant="solid"
                onClick={() => {
                  setDrawer(false);
                  onLocalAction({
                    type: 'PLACEHOLDER_ACTION',
                    label: 'Secretary assigned',
                  });
                }}
              >
                Assign Secretary
              </ActionButton>
            </>
          ) : null}
          {choice === 'invite' ? (
            <>
              <h3>Invite New Secretary</h3>
              <p>Send an invitation to join North Clinic.</p>
              <label>
                First name
                <input defaultValue="Ana" />
              </label>
              <label>
                Last name
                <input defaultValue="Garcia" />
              </label>
              <label>
                Email
                <input defaultValue="ana.garcia@example.com" />
              </label>
              <label>
                Mobile number
                <input defaultValue="0912 345 6789" />
              </label>
              <ActionButton
                variant="solid"
                onClick={() => {
                  setStaff((current) => [
                    ...current,
                    {
                      initials: 'AG',
                      name: 'Ana Garcia',
                      email: 'ana.garcia@example.com',
                      phone: '0912 345 6789',
                      status: 'Pending',
                      assigned: 'Invitation sent Aug 25, 2026',
                    },
                  ]);
                  setDrawer(false);
                  onLocalAction({
                    type: 'PLACEHOLDER_ACTION',
                    label: 'Invitation sent',
                  });
                }}
              >
                Send Invitation
              </ActionButton>
            </>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

export function ClinicOperationsWorkspace({
  clinic,
  onBack,
  onEvent,
  overview,
  overviewLoading = false,
  overviewError = '',
  queue,
  queueLoading = false,
  queueError = '',
  onOverviewServiceDateChange,
}: {
  clinic: { name: string; address: string; timeZone: string };
  onBack: () => void;
  onEvent?: (event: ClinicOperationsEvent) => void;
  overview?: ClinicOperationsOverview | null;
  overviewLoading?: boolean;
  overviewError?: string;
  queue?: ClinicOperationsQueue | null;
  queueLoading?: boolean;
  queueError?: string;
  onOverviewServiceDateChange?: (serviceDate: string) => void;
}) {
  const [tab, setTab] = useState<OperationsTab>('overview');
  const [serviceDate, setServiceDate] = useState('2026-08-25');
  const [previewPatients, setPreviewPatients] = useState(initialPatients);
  const authoritativePatients = useMemo(
    () =>
      queue?.patients.flatMap<Patient>((patient) => {
        const status =
          patient.status === 'CALLED' ? 'NOW SERVING' : patient.status;
        if (
          ![
            'WAITING',
            'NOW SERVING',
            'OUT FOR PROCEDURE',
            'TEMPORARILY ABSENT',
            'COMPLETED',
            'CANCELLED',
          ].includes(status)
        )
          return [];
        return [
          {
            id: patient.id,
            queue: formatQueueNumber(patient.queueNumber),
            name: patient.name,
            reference: patient.bookingReference,
            service: patient.serviceNames.join(', ') || '—',
            time: new Intl.DateTimeFormat('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            }).format(new Date(patient.enteredAt)),
            source: patient.source === 'ONLINE' ? 'Online' : 'Staff-assisted',
            status: status as PatientStatus,
          },
        ];
      }) ?? null,
    [queue],
  );
  const patients = authoritativePatients ?? previewPatients;
  const [notice, setNotice] = useState('');
  const waiting = useMemo(
    () => patients.filter((p) => p.status === 'WAITING').length,
    [patients],
  );
  function changeServiceDate(value: string) {
    setServiceDate(value);
    onOverviewServiceDateChange?.(value);
  }
  function handleEvent(event: ClinicOperationsEvent) {
    onEvent?.(event);
    if (event.type === 'CALL_NEXT') {
      if (!queue)
        setPreviewPatients((current) =>
          current.map((p) =>
            p.status === 'NOW SERVING'
              ? { ...p, status: 'COMPLETED' }
              : p.id === event.patientId
                ? { ...p, status: 'NOW SERVING' }
                : p,
          ),
        );
      setNotice('The next patient is now being served.');
    } else if (event.type === 'COMPLETE_CURRENT') {
      if (!queue)
        setPreviewPatients((current) =>
          current.map((p) =>
            p.id === event.patientId ? { ...p, status: 'COMPLETED' } : p,
          ),
        );
      setNotice('Patient marked as completed.');
    } else if (event.type === 'RETURN_TO_QUEUE') {
      if (!queue)
        setPreviewPatients((current) =>
          current.map((p) =>
            p.id === event.patientId ? { ...p, status: 'WAITING' } : p,
          ),
        );
      setNotice('Patient returned to the waiting queue.');
    } else if (event.type === 'GENERATE_PDF')
      setNotice('PDF generation is ready for backend connection.');
    else if (event.type === 'PLACEHOLDER_ACTION')
      setNotice(`${event.label} updated in this frontend preview.`);
  }
  return (
    <section className="clinic-operations-page">
      <button className="clinic-operations-back" type="button" onClick={onBack}>
        ← Back to Clinics
      </button>
      <div className="clinic-operations-heading">
        <div>
          <h1>
            {tab === 'overview'
              ? clinic.name
              : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </h1>
          <p>
            {clinic.name} • {overview?.clinic.doctorName ?? 'Doctor account'}
          </p>
        </div>
        <button className="ops-action is-outline">
          {tab === 'queue' ? 'Queue Actions' : 'Clinic Actions'} ⌄
        </button>
      </div>
      <nav className="ops-tabs" aria-label="Clinic operations">
        <button
          className={tab === 'overview' ? 'is-active' : ''}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          className={tab === 'queue' ? 'is-active' : ''}
          onClick={() => setTab('queue')}
        >
          Queue
        </button>
        <button
          className={tab === 'appointments' ? 'is-active' : ''}
          onClick={() => setTab('appointments')}
        >
          Appointments
        </button>
        <button
          className={tab === 'staff' ? 'is-active' : ''}
          onClick={() => setTab('staff')}
        >
          Staff
        </button>
      </nav>
      {notice ? (
        <div className="clinic-local-notice" role="status">
          {notice}
          <button onClick={() => setNotice('')} aria-label="Dismiss message">
            ×
          </button>
        </div>
      ) : null}
      {tab === 'overview' && overviewLoading ? (
        <div className="ops-workspace-state" role="status">
          Loading clinic operations…
        </div>
      ) : null}
      {tab === 'overview' && overviewError ? (
        <div className="ops-workspace-state is-error" role="alert">
          <strong>Unable to load clinic operations.</strong>
          <span>{overviewError}</span>
        </div>
      ) : null}
      {tab === 'overview' && overview ? (
        <OverviewTab
          operations={overview}
          goTo={setTab}
          serviceDate={serviceDate}
          onServiceDateChange={changeServiceDate}
        />
      ) : null}
      {tab === 'overview' && !overview && !overviewLoading && !overviewError ? (
        <div className="ops-workspace-state">
          No operational data is available for this clinic.
        </div>
      ) : null}
      {tab === 'queue' && queueLoading ? (
        <div className="ops-workspace-state" role="status">Loading queue…</div>
      ) : null}
      {tab === 'queue' && queueError ? (
        <div className="ops-workspace-state is-error" role="alert"><strong>Unable to load the queue.</strong><span>{queueError}</span></div>
      ) : null}
      {tab === 'queue' && !queueLoading && !queueError && (!queue || (patients.some((patient) => patient.status === 'NOW SERVING') && patients.some((patient) => patient.status === 'WAITING'))) ? (
        <QueueTab
          patients={patients}
          onLocalAction={handleEvent}
          serviceDate={serviceDate}
          onServiceDateChange={changeServiceDate}
        />
      ) : null}
      {tab === 'queue' && queue && !queueLoading && !queueError && (!patients.some((patient) => patient.status === 'NOW SERVING') || !patients.some((patient) => patient.status === 'WAITING')) ? (
        <div className="ops-workspace-state"><strong>No active serving sequence</strong><span>{queue.clinicDay?.status === 'STARTED' ? 'The queue currently has no patient ready to call.' : 'Start the clinic day before serving patients.'}</span></div>
      ) : null}
      {tab === 'appointments' ? (
        <AppointmentsTab
          patients={patients}
          onLocalAction={handleEvent}
          serviceDate={serviceDate}
          onServiceDateChange={changeServiceDate}
        />
      ) : null}
      {tab === 'staff' ? <StaffTab onLocalAction={handleEvent} /> : null}
      <footer className="ops-scope-note">
        {overview
          ? `${overview.clinic.address || 'Clinic address'} · ${overview.clinic.timeZone ?? clinic.timeZone} · ${overview.queue.waitingCount} patients waiting`
          : `Frontend preview · ${clinic.address || 'Clinic address'} · ${clinic.timeZone} · ${waiting} mock patients waiting`}
      </footer>
    </section>
  );
}
