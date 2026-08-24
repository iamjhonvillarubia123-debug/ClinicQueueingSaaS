import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type ReviewSummary = {
  id: string;
  status: 'SUBMITTED';
  submittedAt: string | null;
  practiceLocation: { id: string; name: string | null; lifecycleStatus: string };
  authorPracticeStaff: { user: { firstName: string; lastName: string } };
};

type ReviewDetail = ReviewSummary & {
  reviewedAt: string | null;
  reviewComment: string | null;
  practiceLocation: ReviewSummary['practiceLocation'] & {
    timeZone: string | null;
    practiceSchedules: Array<{ weekday: string; isOpen: boolean; opensAtLocal: string | null; closesAtLocal: string | null; maximumOnlineBookingUntilLocal: string | null; maximumOperatingUntilLocal: string | null }>;
    scheduleExceptions: Array<{ serviceDate: string; isOpen: boolean; opensAtLocal: string | null; closesAtLocal: string | null; maximumOnlineBookingUntilLocal: string | null; maximumOperatingUntilLocal: string | null }>;
    services: Array<{ id: string; name: string; durationMinutes: number; status: string }>;
    bookingQuestions: Array<{ id: string; questionText: string; type: string; isRequired: boolean; displayOrder: number; isActive: boolean }>;
  };
  proposedPracticeSchedules: Array<{ weekday: string; proposedIsOpen: boolean; proposedOpensAtLocal: string | null; proposedClosesAtLocal: string | null; proposedMaximumOnlineBookingUntilLocal: string | null; proposedMaximumOperatingUntilLocal: string | null }>;
  proposedScheduleExceptions: Array<{ serviceDate: string; proposedIsOpen: boolean; proposedOpensAtLocal: string | null; proposedClosesAtLocal: string | null; proposedMaximumOnlineBookingUntilLocal: string | null; proposedMaximumOperatingUntilLocal: string | null }>;
  proposedServices: Array<{ id: string; practiceLocationServiceId: string | null; proposedName: string; proposedDurationMinutes: number; proposedStatus: string }>;
  proposedBookingQuestions: Array<{ id: string; bookingQuestionId: string | null; proposedQuestionText: string; proposedType: string; proposedIsRequired: boolean; proposedDisplayOrder: number; proposedIsActive: boolean }>;
};

function messageFrom(error: unknown) {
  return error instanceof ApiError ? error.message : 'Unable to complete this review action. Please try again.';
}
function timeOnly(value: string | null | undefined) {
  if (!value) return '—';
  const match = /T(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value.slice(0, 5);
}
function dateOnly(value: string) {
  return /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] ?? value;
}
function scheduleText(row: { isOpen: boolean; opensAtLocal: string | null; closesAtLocal: string | null; maximumOnlineBookingUntilLocal?: string | null; maximumOperatingUntilLocal?: string | null }) {
  if (!row.isOpen) return 'Closed';
  return `${timeOnly(row.opensAtLocal)}–${timeOnly(row.closesAtLocal)} · booking cutoff ${timeOnly(row.maximumOnlineBookingUntilLocal)} · operating until ${timeOnly(row.maximumOperatingUntilLocal)}`;
}
function proposalScheduleText(row: { proposedIsOpen: boolean; proposedOpensAtLocal: string | null; proposedClosesAtLocal: string | null; proposedMaximumOnlineBookingUntilLocal?: string | null; proposedMaximumOperatingUntilLocal?: string | null }) {
  return scheduleText({ isOpen: row.proposedIsOpen, opensAtLocal: row.proposedOpensAtLocal, closesAtLocal: row.proposedClosesAtLocal, maximumOnlineBookingUntilLocal: row.proposedMaximumOnlineBookingUntilLocal, maximumOperatingUntilLocal: row.proposedMaximumOperatingUntilLocal });
}

export function SecretaryDraftReviewsPage() {
  const [items, setItems] = useState<ReviewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiRequest<ReviewSummary[]>('/doctor-settings-draft-reviews')
      .then(setItems)
      .catch((caught) => setError(messageFrom(caught)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="practice-admin-page" aria-labelledby="draft-reviews-heading">
      <div className="practice-admin-heading"><div><p className="eyebrow">Secretary governance</p><h1 id="draft-reviews-heading">Settings reviews</h1><p>Review submitted Secretary proposals before any change becomes effective.</p></div></div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {loading ? <p className="practice-muted">Loading submitted drafts…</p> : null}
      {!loading && items.length === 0 ? <div className="practice-empty"><h2>No drafts waiting for review</h2><p>Submitted Secretary settings proposals will appear here.</p></div> : null}
      <section className="practice-list" aria-label="Submitted settings drafts">
        {items.map((item) => (
          <article className="practice-location-card" key={item.id}>
            <div><div className="practice-location-title-row"><h2>{item.practiceLocation.name?.trim() || 'Untitled clinic location'}</h2><span className="practice-status">SUBMITTED</span></div><p>Submitted by {item.authorPracticeStaff.user.firstName} {item.authorPracticeStaff.user.lastName}.</p><div className="practice-location-meta"><span>{item.practiceLocation.lifecycleStatus.replaceAll('_', ' ')}</span><span>{item.submittedAt ? new Date(item.submittedAt).toLocaleString() : 'Submission time unavailable'}</span></div></div>
            <div className="practice-card-actions"><Link className="primary-action" to={`/app/secretary-draft-reviews/${encodeURIComponent(item.id)}`}>Review changes</Link></div>
          </article>
        ))}
      </section>
    </section>
  );
}

export function SecretaryDraftReviewPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!draftId) return;
    setLoading(true);
    setError('');
    try { setDetail(await apiRequest<ReviewDetail>(`/doctor-settings-draft-reviews/${encodeURIComponent(draftId)}`)); }
    catch (caught) { setError(messageFrom(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [draftId]);

  async function decide(action: 'approve' | 'reject' | 'return-for-rework') {
    if (!draftId || working) return;
    if (action === 'return-for-rework' && !comment.trim()) { setError('Add a note explaining what the Secretary should change.'); return; }
    setWorking(action); setError('');
    try {
      await apiRequest(`/secretary-settings-drafts/${encodeURIComponent(draftId)}/${action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: action === 'approve' ? undefined : { reviewComment: comment.trim() || undefined },
      });
      navigate('/app/secretary-draft-reviews', { replace: true });
    } catch (caught) { setError(messageFrom(caught)); }
    finally { setWorking(''); }
  }

  const scheduleByDay = useMemo(() => new Map(detail?.practiceLocation.practiceSchedules.map((row) => [row.weekday, row]) ?? []), [detail]);
  const exceptionByDate = useMemo(() => new Map(detail?.practiceLocation.scheduleExceptions.map((row) => [dateOnly(row.serviceDate), row]) ?? []), [detail]);
  const serviceById = useMemo(() => new Map(detail?.practiceLocation.services.map((row) => [row.id, row]) ?? []), [detail]);
  const questionById = useMemo(() => new Map(detail?.practiceLocation.bookingQuestions.map((row) => [row.id, row]) ?? []), [detail]);
  const proposalCount = detail ? detail.proposedPracticeSchedules.length + detail.proposedScheduleExceptions.length + detail.proposedServices.length + detail.proposedBookingQuestions.length : 0;

  if (loading) return <section className="practice-admin-page"><p className="practice-muted">Loading submitted draft…</p></section>;
  if (!detail) return <section className="practice-admin-page">{error ? <div className="form-error" role="alert">{error}</div> : null}<Link to="/app/secretary-draft-reviews">Back to reviews</Link></section>;

  return (
    <section className="practice-admin-page" aria-labelledby="review-heading">
      <div className="practice-admin-heading"><div><p className="eyebrow">Secretary proposal review</p><h1 id="review-heading">{detail.practiceLocation.name?.trim() || 'Clinic settings'}</h1><p>Compare the current effective configuration with the Secretary's proposed changes. Approval revalidates current state before applying anything.</p></div><Link className="secondary-action" to="/app/secretary-draft-reviews">← Reviews</Link></div>
      <div className="practice-notice"><strong>{proposalCount} proposed change{proposalCount === 1 ? '' : 's'}</strong> · Submitted by {detail.authorPracticeStaff.user.firstName} {detail.authorPracticeStaff.user.lastName}. Nothing below is effective until approval succeeds.</div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}

      {detail.proposedPracticeSchedules.length ? <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Recurring schedule</p><h2>Clinic hours proposals</h2></div>{detail.proposedPracticeSchedules.map((row) => { const current = scheduleByDay.get(row.weekday); return <article className="practice-location-card" key={row.weekday}><div><h3>{row.weekday.charAt(0) + row.weekday.slice(1).toLowerCase()}</h3><p><strong>Current:</strong> {current ? scheduleText(current) : 'No recurring schedule configured'}</p><p><strong>Proposed:</strong> {proposalScheduleText(row)}</p></div></article>; })}</section> : null}

      {detail.proposedScheduleExceptions.length ? <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Date-specific schedule</p><h2>Exception proposals</h2></div>{detail.proposedScheduleExceptions.map((row) => { const key = dateOnly(row.serviceDate); const current = exceptionByDate.get(key); return <article className="practice-location-card" key={row.id}><div><h3>{key}</h3><p><strong>Current:</strong> {current ? scheduleText(current) : 'No date-specific exception'}</p><p><strong>Proposed:</strong> {proposalScheduleText(row)}</p></div></article>; })}</section> : null}

      {detail.proposedServices.length ? <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Services</p><h2>Service proposals</h2></div>{detail.proposedServices.map((row) => { const current = row.practiceLocationServiceId ? serviceById.get(row.practiceLocationServiceId) : undefined; return <article className="practice-location-card" key={row.id}><div><p><strong>Current:</strong> {current ? `${current.name} · ${current.durationMinutes} min · ${current.status}` : 'New service'}</p><p><strong>Proposed:</strong> {row.proposedName} · {row.proposedDurationMinutes} min · {row.proposedStatus}</p></div></article>; })}</section> : null}

      {detail.proposedBookingQuestions.length ? <section className="practice-create-panel"><div className="practice-panel-heading"><p className="eyebrow">Booking questions</p><h2>Question proposals</h2></div>{detail.proposedBookingQuestions.map((row) => { const current = row.bookingQuestionId ? questionById.get(row.bookingQuestionId) : undefined; return <article className="practice-location-card" key={row.id}><div><p><strong>Current:</strong> {current ? `${current.questionText} · ${current.type} · ${current.isActive ? 'Active' : 'Inactive'}` : 'New booking question'}</p><p><strong>Proposed:</strong> {row.proposedQuestionText} · {row.proposedType} · {row.proposedIsActive ? 'Active' : 'Inactive'}</p></div></article>; })}</section> : null}

      <section className="practice-create-panel" aria-labelledby="review-decision-heading"><div className="practice-panel-heading"><p className="eyebrow">Doctor decision</p><h2 id="review-decision-heading">Decide this submission</h2><p>Approve applies the proposal atomically after backend revalidation. Reject closes it. Return for rework reopens the same draft for the Secretary.</p></div><form className="practice-form" onSubmit={(event: FormEvent) => event.preventDefault()}><label>Note to Secretary <span className="optional">Required for return for rework</span><textarea maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} /></label><div className="button-row"><button className="primary" type="button" disabled={Boolean(working)} onClick={() => void decide('approve')}>{working === 'approve' ? 'Approving…' : 'Approve and apply'}</button><button className="secondary" type="button" disabled={Boolean(working)} onClick={() => void decide('return-for-rework')}>{working === 'return-for-rework' ? 'Returning…' : 'Return for rework'}</button><button className="secondary" type="button" disabled={Boolean(working)} onClick={() => void decide('reject')}>{working === 'reject' ? 'Rejecting…' : 'Reject'}</button></div></form></section>
    </section>
  );
}
