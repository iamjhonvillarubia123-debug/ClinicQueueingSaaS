import { OperationsIcon, type OperationsIconName } from './OperationsIcon';

export type AppointmentDetailsModel = {
  queue: string;
  name: string;
  reference: string;
  service: string;
  source: string;
  status: string;
};

type DetailsProps = {
  appointment: AppointmentDetailsModel;
  onClose: () => void;
  onReport: () => void;
};

export function AppointmentDetailsDrawer({ appointment, onClose, onReport }: DetailsProps) {
  return <aside className="appointment-detail-drawer"><header><h2>Appointment Details</h2><button type="button" onClick={onClose} aria-label="Close appointment details">×</button></header><div className="appointment-detail-body"><section className="appointment-person"><span>♙</span><div><h3>{appointment.name} <em>{appointment.status}</em></h3><p>{appointment.reference} • Queue {appointment.queue}</p></div></section><DetailSection icon="♙" title="Patient Information"><dl><dt>Full Name</dt><dd>{appointment.name}</dd><dt>Mobile Number</dt><dd>0917 123 4567</dd></dl></DetailSection><DetailSection icon="▣" title="Appointment Information"><dl><dt>Service Date</dt><dd>Aug 25, 2026 (Tuesday)</dd><dt>Source</dt><dd>{appointment.source}</dd><dt>Booked Service(s)</dt><dd>{appointment.service}</dd><dt>Estimated Service Duration</dt><dd>15 min</dd></dl></DetailSection><DetailSection icon="▤" title="Queue Information"><dl><dt>Queue Number</dt><dd>{appointment.queue}</dd><dt>Current Status</dt><dd><i /> {appointment.status}</dd><dt>Entered Queue</dt><dd>8:15 AM</dd><dt>Called</dt><dd>{appointment.status === 'NOW SERVING' ? '9:15 AM' : '—'}</dd><dt>Completed</dt><dd>{appointment.status === 'COMPLETED' ? '10:02 AM' : '—'}</dd><dt>Temporarily Absent</dt><dd>—</dd><dt>Out for Procedure</dt><dd>—</dd></dl></DetailSection><DetailSection icon="☑" title="Booking Questions & Answers"><ol><li><span>What is the main reason for your visit?</span><strong>Toothache</strong></li><li><span>Are you experiencing any fever?</span><strong>No</strong></li><li><span>Have you been to this clinic before?</span><strong>Yes</strong></li><li><span>Are you allergic to any medicines?</span><strong>Penicillin</strong></li></ol><button className="appointment-view-all">View all questions and answers</button></DetailSection><DetailSection icon="◷" title="Appointment History"><div className="appointment-history"><div><time>8:15 AM</time><span><strong>Entered queue</strong><small>By System</small></span></div><div><time>9:15 AM</time><span><strong>Called / Now Serving</strong><small>By Maria Santos (Secretary)</small></span></div></div></DetailSection></div><footer><button className="is-report" type="button" onClick={onReport}>▤ Print / Save PDF</button><button type="button" onClick={onClose}>Close</button></footer></aside>;
}

function DetailSection({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  const iconMap: Record<string, OperationsIconName> = { '♙': 'person', '▣': 'calendar', '▤': 'clinic', '☑': 'check', '◷': 'clock' };
  return <section className="appointment-detail-section"><h3><span><OperationsIcon name={iconMap[icon] ?? 'info'} size={18} /></span>{title}</h3>{children}</section>;
}

const reportPatients: AppointmentDetailsModel[] = [
  { queue: '#06', name: 'Maria Santos', reference: '#APP-0012', service: 'General Consultation', source: 'Online', status: 'NOW SERVING' },
  { queue: '#07', name: 'Pedro Reyes', reference: '#APP-0013', service: 'Dental Cleaning', source: 'Online', status: 'WAITING' },
  { queue: '#08', name: 'Anna Garcia', reference: '#APP-0014', service: 'General Consultation', source: 'Staff-assisted', status: 'WAITING' },
  { queue: '#09', name: 'Juan Dela Cruz', reference: '#APP-0015', service: 'Laboratory Test', source: 'Online', status: 'OUT FOR PROCEDURE' },
];

export function AppointmentReportPreview({ mode, appointment, onClose, onGenerate }: { mode: 'single' | 'daily'; appointment?: AppointmentDetailsModel; onClose: () => void; onGenerate: () => void }) {
  const patient = appointment ?? reportPatients[0];
  return <div className="appointment-report-overlay" role="dialog" aria-modal="true" aria-label={mode === 'single' ? 'Single appointment report preview' : 'Daily appointment report preview'}><div className="appointment-report-shell"><header><div><h2>{mode === 'single' ? 'Single Appointment Report' : 'Service Date Appointment Report'}</h2><p>Preview before generating the PDF.</p></div><button type="button" onClick={onClose} aria-label="Close report preview">×</button></header><article className="appointment-paper"><div className="report-brand"><span>+</span><div><h2>NORTH CLINIC</h2><p>Dr. Juan Dela Cruz</p></div><section><h3>{mode === 'single' ? 'APPOINTMENT REPORT' : 'DAILY APPOINTMENT REPORT'}</h3><p>Service Date : August 25, 2026 (Tuesday)</p><p>Generated  : August 25, 2026 · 10:30 AM</p></section></div>{mode === 'single' ? <SingleReport patient={patient} /> : <DailyReport />}<footer><span>♢ Contains patient information.<br />  For authorized clinic use only.</span><span>Clinic Queueing SaaS<br />North Clinic · Authorized clinic use.</span></footer></article><div className="appointment-report-actions"><button type="button" onClick={onClose}>Back</button><button className="is-primary" type="button" onClick={onGenerate}>▤ Generate PDF</button></div></div></div>;
}

function SingleReport({ patient }: { patient: AppointmentDetailsModel }) {
  return <div className="single-report-grid"><ReportBox title="♙ PATIENT INFORMATION"><dl><dt>Full Name</dt><dd>{patient.name}</dd><dt>Mobile Number</dt><dd>0917 123 4567</dd></dl></ReportBox><ReportBox title="▣ APPOINTMENT INFORMATION"><dl><dt>Appointment Reference</dt><dd>{patient.reference}</dd><dt>Queue Number</dt><dd>{patient.queue}</dd><dt>Current Status</dt><dd className="is-green">{patient.status}</dd><dt>Source</dt><dd>{patient.source}</dd><dt>Booked Date</dt><dd>August 20, 2026 · 2:45 PM</dd></dl></ReportBox><ReportBox title="▤ BOOKED SERVICES"><div className="report-service"><span>Service</span><span>Estimated Duration</span><strong>{patient.service}</strong><strong>15 minutes</strong></div><p>Total Estimated Service Duration: 15 minutes</p></ReportBox><ReportBox wide title="▱ BOOKING QUESTIONS & ANSWERS"><ol><li>What is the main reason for your visit? <strong>Toothache</strong></li><li>Are you experiencing any fever? <strong>No</strong></li><li>Have you been to this clinic before? <strong>Yes</strong></li><li>Are you allergic to any medicines? <strong>Penicillin</strong></li></ol></ReportBox><ReportBox wide title="◷ APPOINTMENT HISTORY"><div className="report-history"><strong>Date & Time</strong><strong>Event</strong><strong>By</strong><span>August 25, 2026 · 8:15 AM</span><span>Entered queue</span><span>By System</span><span>August 25, 2026 · 9:15 AM</span><span>Called / Now Serving</span><span>Maria Santos (Secretary)</span></div></ReportBox></div>;
}

function DailyReport() {
  return <><div className="daily-report-summary"><p>Clinic Hours: <strong>8:00 AM – 5:00 PM</strong><br />Total Appointments: <strong>12</strong></p>{[['1','Now Serving'],['2','Waiting'],['1','Out for Procedure'],['1','Temporarily Absent'],['6','Completed'],['1','Cancelled'],['0','Expired / No-show']].map(([count,label]) => <div key={label}><strong>{count}</strong><small>{label}</small></div>)}</div><div className="daily-report-patients">{reportPatients.map((patient) => <section key={patient.queue}><b>{patient.queue}</b><div><strong>{patient.name}</strong><small>Mobile: 0917 123 4567</small></div><div><small>Service(s):</small><strong>• {patient.service}</strong><small>(Est. 15 min)</small></div><div><small>Status:</small><em>{patient.status}</em><small>{patient.status === 'NOW SERVING' ? 'Called: 9:15 AM' : 'Waiting since 9:20 AM'}</small></div><div><small>Booking Questions</small><span>• Main reason: Toothache</span><span>• Fever: No</span><span>• Previous visit: Yes</span></div></section>)}</div><p className="daily-more">… and 8 more appointments</p></>;
}

function ReportBox({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return <section className={`report-box${wide ? ' is-wide' : ''}`}><h3>{title}</h3>{children}</section>;
}
