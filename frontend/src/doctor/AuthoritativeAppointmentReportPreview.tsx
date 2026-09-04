import type { AppointmentDetailsModel } from './AppointmentDetailsDrawer';
import { formatServiceDate } from './ServiceDateControl';
import './AuthoritativeAppointmentReportPreview.css';

export type AuthoritativeAppointmentReport = {
  clinic: {
    id: string;
    name: string | null;
    address: string;
    timeZone: string | null;
    doctorName: string;
  };
  serviceDate: string;
  schedule: {
    isOpen: boolean;
    opensAt: string | null;
    closesAt: string | null;
  } | null;
  counts: Record<string, number>;
  appointments: AppointmentDetailsModel[];
  generatedAt: string;
};

function statusLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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

export function AuthoritativeAppointmentReportPreview({
  report,
  onClose,
}: {
  report: AuthoritativeAppointmentReport;
  onClose: () => void;
}) {
  const hours = report.schedule?.isOpen
    ? `${formatHour(report.schedule.opensAt)} – ${formatHour(report.schedule.closesAt)}`
    : 'Closed';

  return (
    <div className="authoritative-report-overlay" role="dialog" aria-modal="true" aria-label="Daily appointment PDF preview">
      <div className="authoritative-report-shell">
        <header className="authoritative-report-toolbar">
          <div>
            <h2>Service Date Appointment Report</h2>
            <p>Preview the authoritative clinic data before printing or saving as PDF.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close appointment report">×</button>
        </header>

        <article className="authoritative-report-paper" id="authoritative-appointment-report">
          <header className="authoritative-report-heading">
            <div>
              <strong>{report.clinic.name ?? 'Unnamed clinic'}</strong>
              <span>{report.clinic.doctorName}</span>
              <span>{report.clinic.address || 'Address unavailable'}</span>
            </div>
            <div>
              <h1>Daily Appointment Report</h1>
              <span>Service Date: {formatServiceDate(report.serviceDate, true)}</span>
              <span>Clinic Hours: {hours}</span>
              <span>Generated: {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.generatedAt))}</span>
            </div>
          </header>

          <section className="authoritative-report-summary" aria-label="Appointment status summary">
            <div><strong>{report.appointments.length}</strong><span>Total Appointments</span></div>
            <div><strong>{report.counts.WAITING ?? 0}</strong><span>Waiting</span></div>
            <div><strong>{report.counts.CALLED ?? 0}</strong><span>Now Serving</span></div>
            <div><strong>{report.counts.OUT_FOR_PROCEDURE ?? 0}</strong><span>Out for Procedure</span></div>
            <div><strong>{report.counts.TEMPORARILY_ABSENT ?? 0}</strong><span>Temporarily Absent</span></div>
            <div><strong>{report.counts.COMPLETED ?? 0}</strong><span>Completed</span></div>
            <div><strong>{report.counts.CANCELLED ?? 0}</strong><span>Cancelled</span></div>
          </section>

          {report.appointments.length ? (
            <section className="authoritative-report-list">
              {report.appointments.map((appointment) => (
                <article key={String(appointment.id ?? appointment.reference)}>
                  <div className="authoritative-report-queue">{appointment.queue}</div>
                  <div>
                    <strong>{appointment.name}</strong>
                    <span>{appointment.reference}</span>
                    <span>Mobile: {appointment.mobileNumber ?? 'Unavailable'}</span>
                  </div>
                  <div>
                    <strong>{appointment.services?.map((service) => service.name).join(', ') || appointment.service}</strong>
                    <span>Estimated service: {appointment.estimatedServiceMinutes ?? '—'} min</span>
                    <span>Source: {appointment.source}</span>
                  </div>
                  <div>
                    <strong>{statusLabel(appointment.status)}</strong>
                    <span>Booking questions:</span>
                    {appointment.answers?.length ? appointment.answers.map((answer) => (
                      <span key={answer.questionId}>{answer.question}: {answer.answer ?? '—'}</span>
                    )) : <span>None recorded</span>}
                  </div>
                </article>
              ))}
            </section>
          ) : (
            <p className="authoritative-report-empty">No appointments were recorded for this service date.</p>
          )}

          <footer className="authoritative-report-footer">
            <span>Contains patient information. For authorized clinic use only.</span>
            <span>Clinic Queueing SaaS</span>
          </footer>
        </article>

        <footer className="authoritative-report-actions">
          <button type="button" onClick={onClose}>Back</button>
          <button className="is-primary" type="button" onClick={() => window.print()}>Print / Save PDF</button>
        </footer>
      </div>
    </div>
  );
}
