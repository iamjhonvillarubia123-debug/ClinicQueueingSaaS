import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import type { AppointmentDetailsModel } from './AppointmentDetailsDrawer';
import type { AuthoritativeAppointmentReport } from './AuthoritativeAppointmentReportPreview';
import { AuthoritativeClinicOperationsWorkspace } from './AuthoritativeClinicOperationsWorkspace';
import type {
  ClinicOperationsEvent,
  ClinicOperationsOverview,
  ClinicOperationsQueue,
} from './ClinicOperationsWorkspace';
import type { QueueDrawerBookingConfiguration } from './QueueActionDrawer';
import { ServiceDateTodayProvider } from './ServiceDateControl';

type AppointmentDetailsResponse = {
  id: string;
  bookingReference: string;
  queueNumber: number;
  status: string;
  serviceDate: string;
  estimatedServiceMinutes: number;
  patientName: string;
  mobileNumber: string | null;
  source: 'ONLINE' | 'STAFF_ASSISTED';
  createdAt: string;
  calledAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  services: Array<{ id: string; name: string; durationMinutes: number }>;
  answers: Array<{ questionId: string; question: string; answer: string | null }>;
  history: Array<{
    id: string;
    type: string;
    occurredAt: string;
    actorName: string;
    actorRole: string;
  }>;
};

type AppointmentReportResponse = {
  clinic: AuthoritativeAppointmentReport['clinic'];
  serviceDate: string;
  schedule: AuthoritativeAppointmentReport['schedule'];
  counts: Record<string, number>;
  appointments: AppointmentDetailsResponse[];
  generatedAt: string;
};

type OperationsContext = {
  practiceLocationId: string;
  clinicName: string | null;
  timeZone: string;
  currentServiceDate: string;
};

function mapAppointmentDetails(details: AppointmentDetailsResponse): AppointmentDetailsModel {
  return {
    id: details.id,
    queue: `#${String(details.queueNumber).padStart(2, '0')}`,
    name: details.patientName || 'Identity unavailable',
    reference: details.bookingReference,
    service: details.services.map((service) => service.name).join(', ') || '—',
    source: details.source === 'ONLINE' ? 'Online' : 'Staff-assisted',
    status: details.status === 'CALLED' ? 'NOW SERVING' : details.status.replaceAll('_', ' '),
    mobileNumber: details.mobileNumber,
    serviceDate: details.serviceDate,
    estimatedServiceMinutes: details.estimatedServiceMinutes,
    createdAt: details.createdAt,
    calledAt: details.calledAt,
    completedAt: details.completedAt,
    cancelledAt: details.cancelledAt,
    services: details.services,
    answers: details.answers,
    history: details.history,
  };
}

export function AuthoritativeClinicOperationsRoutePage() {
  const navigate = useNavigate();
  const { clinicId } = useParams();
  const [operationsContext, setOperationsContext] = useState<OperationsContext | null>(null);
  const [contextError, setContextError] = useState('');
  const [serviceDate, setServiceDate] = useState<string | null>(null);
  const [overview, setOverview] = useState<ClinicOperationsOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [queue, setQueue] = useState<ClinicOperationsQueue | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [appointments, setAppointments] = useState<ClinicOperationsQueue | null>(null);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [appointmentsError, setAppointmentsError] = useState('');
  const [bookingConfiguration, setBookingConfiguration] = useState<QueueDrawerBookingConfiguration | null>(null);
  const [operationsRevision, setOperationsRevision] = useState(0);

  useEffect(() => {
    if (!clinicId) {
      setOperationsContext(null);
      setServiceDate(null);
      setContextError('Clinic identifier is missing.');
      return;
    }
    let cancelled = false;
    setOperationsContext(null);
    setServiceDate(null);
    setContextError('');
    void apiRequest<OperationsContext>(
      `/practice-location/${encodeURIComponent(clinicId)}/operations/context`,
    )
      .then((result) => {
        if (!cancelled) {
          setOperationsContext(result);
          setServiceDate(result.currentServiceDate);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setContextError(
            error instanceof Error
              ? error.message
              : 'Unable to determine the clinic-local service date.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  useEffect(() => {
    if (!clinicId) {
      setBookingConfiguration(null);
      return;
    }
    let cancelled = false;
    void apiRequest<QueueDrawerBookingConfiguration>(`/booking/configuration/${encodeURIComponent(clinicId)}`)
      .then((result) => { if (!cancelled) setBookingConfiguration(result); })
      .catch(() => { if (!cancelled) setBookingConfiguration(null); });
    return () => { cancelled = true; };
  }, [clinicId]);

  useEffect(() => {
    let cancelled = false;
    if (!clinicId || !serviceDate) return;
    setOverviewLoading(true);
    setOverviewError('');
    void apiRequest<ClinicOperationsOverview>(`/practice-location/${encodeURIComponent(clinicId)}/operations/overview?serviceDate=${encodeURIComponent(serviceDate)}`)
      .then((result) => { if (!cancelled) setOverview(result); })
      .catch((error) => {
        if (!cancelled) {
          setOverview(null);
          setOverviewError(error instanceof Error ? error.message : 'Unable to load clinic operations.');
        }
      })
      .finally(() => { if (!cancelled) setOverviewLoading(false); });
    return () => { cancelled = true; };
  }, [clinicId, serviceDate, operationsRevision]);

  useEffect(() => {
    let cancelled = false;
    if (!clinicId || !serviceDate) return;
    setQueueLoading(true);
    setQueueError('');
    void apiRequest<ClinicOperationsQueue>(`/practice-location/${encodeURIComponent(clinicId)}/operations/queue?serviceDate=${encodeURIComponent(serviceDate)}`)
      .then((result) => { if (!cancelled) setQueue(result); })
      .catch((error) => {
        if (!cancelled) {
          setQueue(null);
          setQueueError(error instanceof Error ? error.message : 'Unable to load the queue.');
        }
      })
      .finally(() => { if (!cancelled) setQueueLoading(false); });
    return () => { cancelled = true; };
  }, [clinicId, serviceDate, operationsRevision]);

  useEffect(() => {
    let cancelled = false;
    if (!clinicId || !serviceDate) return;
    setAppointmentsLoading(true);
    setAppointmentsError('');
    void apiRequest<ClinicOperationsQueue>(`/practice-location/${encodeURIComponent(clinicId)}/operations/appointments?serviceDate=${encodeURIComponent(serviceDate)}`)
      .then((result) => { if (!cancelled) setAppointments(result); })
      .catch((error) => {
        if (!cancelled) {
          setAppointments(null);
          setAppointmentsError(error instanceof Error ? error.message : 'Unable to load appointments.');
        }
      })
      .finally(() => { if (!cancelled) setAppointmentsLoading(false); });
    return () => { cancelled = true; };
  }, [clinicId, serviceDate, operationsRevision]);

  async function handleOperationsEvent(event: ClinicOperationsEvent) {
    if (!clinicId || !serviceDate) throw new Error('Clinic service date is not available.');
    if (event.type === 'CALL_NEXT') {
      await apiRequest('/clinic-days/next-patient', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId: clinicId, serviceDate, patientOutcome: event.patientOutcome } });
    } else if (event.type === 'RETURN_TO_QUEUE') {
      await apiRequest('/clinic-days/staff-reinsert', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId: clinicId, serviceDate, appointmentId: String(event.patientId) } });
    } else if (event.type === 'STAFF_REINSERT') {
      await apiRequest('/clinic-days/staff-reinsert', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId: clinicId, serviceDate, appointmentId: String(event.patientId), ...(event.afterPatientId === undefined ? {} : { afterAppointmentId: String(event.afterPatientId) }) } });
    } else if (event.type === 'UNDO_QUEUE') {
      await apiRequest('/clinic-days/undo', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId: clinicId, serviceDate } });
    } else if (event.type === 'ADD_WALK_IN') {
      await apiRequest('/booking/staff-appointment', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId: clinicId, serviceDate, firstName: event.firstName, lastName: event.lastName, mobileNumber: event.mobileNumber, existingPatientResponse: event.existingPatientResponse, selectedServiceIds: event.selectedServiceIds, answers: event.answers } });
    } else if (event.type === 'OPERATIONAL_NOTICE') {
      await apiRequest('/clinic-days/operational-notices/start', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { practiceLocationId: clinicId, serviceDate, kind: event.kind, reason: event.reason, message: event.message, expectedResumeAt: event.expectedResumeAt } });
    } else {
      return;
    }
    setOperationsRevision((current) => current + 1);
  }

  async function loadAppointmentDetails(appointmentId: string | number): Promise<AppointmentDetailsModel> {
    if (!clinicId) throw new Error('Clinic identifier is missing.');
    const details = await apiRequest<AppointmentDetailsResponse>(`/practice-location/${encodeURIComponent(clinicId)}/operations/appointments/${encodeURIComponent(String(appointmentId))}`);
    return mapAppointmentDetails(details);
  }

  async function loadDailyAppointmentReport(): Promise<AuthoritativeAppointmentReport> {
    if (!clinicId || !serviceDate) throw new Error('Clinic service date is not available.');
    const report = await apiRequest<AppointmentReportResponse>(`/practice-location/${encodeURIComponent(clinicId)}/operations/appointment-report?serviceDate=${encodeURIComponent(serviceDate)}`);
    return {
      ...report,
      appointments: report.appointments.map(mapAppointmentDetails),
    };
  }

  if (contextError) {
    return (
      <div className="ops-workspace-state is-error" role="alert">
        <strong>Unable to open clinic operations.</strong>
        <span>{contextError}</span>
      </div>
    );
  }

  if (!serviceDate || !operationsContext) {
    return <div className="ops-workspace-state" role="status">Loading clinic-local service date…</div>;
  }

  return (
    <ServiceDateTodayProvider today={operationsContext.currentServiceDate}>
      <AuthoritativeClinicOperationsWorkspace
        overview={overview}
        overviewLoading={overviewLoading}
        overviewError={overviewError}
        queue={queue}
        queueLoading={queueLoading}
        queueError={queueError}
        appointments={appointments}
        appointmentsLoading={appointmentsLoading}
        appointmentsError={appointmentsError}
        serviceDate={serviceDate}
        onServiceDateChange={setServiceDate}
        onBack={() => navigate('/app/clinics')}
        onEvent={handleOperationsEvent}
        bookingConfiguration={bookingConfiguration}
        loadAppointmentDetails={loadAppointmentDetails}
        loadDailyAppointmentReport={loadDailyAppointmentReport}
      />
    </ServiceDateTodayProvider>
  );
}
