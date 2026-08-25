import { FormEvent, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from './api/client';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './auth/AccountAccessPages';
import { DoctorRegistrationPage } from './auth/DoctorRegistrationPage';
import { AccountSecurityPage, DisabledAccountPage, PermanentCloseAccountPage, ReactivateAccountPage } from './auth/AccountLifecyclePages';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { IndividualBookingPage } from './booking/IndividualBookingPage';
import { MultiPersonBookingPage } from './booking/MultiPersonBookingPage';
import { ClinicServicesQuestionsPage } from './doctor/ClinicServicesQuestionsPage';
import { DoctorDataPrivacyPage } from './doctor/DoctorDataPrivacyPage';
import { DoctorDefaultsPage } from './doctor/DoctorDefaultsPage';
import { PracticeLocationConfigurationPage } from './doctor/PracticeLocationConfigurationPage';
import { PracticeLocationsPage } from './doctor/PracticeLocationsPage';
import { SecretaryDraftReviewPage, SecretaryDraftReviewsPage } from './doctor/SecretaryDraftReviewsPage';
import { SecretaryStaffingPage } from './doctor/SecretaryStaffingPage';
import { BookingRecoveryPage } from './patient/BookingRecoveryPage';
import { BookingAccessBootstrapPage } from './patient/BookingAccessBootstrapPage';
import { PatientAppointmentPage } from './patient/PatientAppointmentPage';
import { PatientBookingGroupPage } from './patient/PatientBookingGroupPage';
import { AppShell } from './presentation/AppShell';
import { DoctorPublicPage, PracticeLocationPublicPage } from './public/PublicPages';
import { SecretaryClinicsPage } from './secretary/SecretaryClinicsPage';
import { SecretaryInvitationPage } from './secretary/SecretaryInvitationPage';
import { SecretaryReplacementInvitationPage } from './secretary/SecretaryReplacementInvitationPage';
import { SecretarySettingsDraftPage } from './secretary/SecretarySettingsDraftPage';

function LandingPage() { return <main className="public-page"><nav className="topbar" aria-label="Primary"><span className="brand">Clinic Queueing</span><Link to="/login">Staff sign in</Link></nav><section className="hero"><p className="eyebrow">Simple clinic queues</p><h1>Less waiting around. More clarity.</h1><p>Open a Doctor or clinic public link to view clinic information and begin booking.</p></section></main>; }

function LoginPage() {
  const { status, login } = useAuth(); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false); const navigate = useNavigate(); const location = useLocation();
  if (status === 'authenticated') return <Navigate to="/app" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(''); setSubmitting(true); try { await login(email, password); const from = (location.state as { from?: string } | null)?.from; navigate(from || '/app', { replace: true }); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to sign in. Please try again.'); } finally { setSubmitting(false); } }
  return <main className="auth-page"><section className="auth-panel" aria-labelledby="signin-heading"><Link className="brand" to="/">Clinic Queueing</Link><div className="auth-heading"><h1 id="signin-heading">Sign in</h1><p>For doctors, secretaries, and authorized system staff.</p></div><form className="stack" onSubmit={submit} noValidate><label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>{error ? <div className="form-error" role="alert">{error}</div> : null}<button className="primary" type="submit" disabled={submitting || !email || !password}>{submitting ? 'Signing in…' : 'Continue'}</button><Link className="quiet-link auth-center-link" to="/forgot-password">Forgot password?</Link><Link className="quiet-link auth-center-link" to="/account/reactivate">Reactivate disabled account</Link></form><div className="auth-registration-entry"><span>Doctor without an account?</span><Link className="secondary-action" to="/register">Create Doctor account</Link></div></section></main>;
}

function WorkspacePage() { const { profile } = useAuth(); if (profile?.role === 'DOCTOR') return <Navigate to="/app/practice-locations" replace />; if (profile?.role === 'SECRETARY') return <Navigate to="/app/secretary/clinics" replace />; return <section className="intro"><p className="eyebrow">Foundation ready</p><h1>System administration</h1><p>Restricted administrative operations remain separate from clinic navigation.</p></section>; }
function LegacyRecoveryRedirect() { const { publicIdentifier } = useParams(); return <Navigate to={publicIdentifier ? `/recover/${encodeURIComponent(publicIdentifier)}` : '/'} replace />; }
function NotFound() { return <main className="auth-page"><section className="auth-panel"><p className="eyebrow">404</p><h1>Page not found</h1><p>The link may be incorrect or no longer available.</p><Link className="link-button" to="/">Return home</Link></section></main>; }

export function App() {
  return <Routes>
    <Route path="/" element={<LandingPage />} /><Route path="/public/doctors/:publicIdentifier" element={<DoctorPublicPage />} /><Route path="/public/practice-locations/:publicIdentifier" element={<PracticeLocationPublicPage />} /><Route path="/book/:publicIdentifier" element={<IndividualBookingPage />} /><Route path="/book/:publicIdentifier/group" element={<MultiPersonBookingPage />} /><Route path="/booking/access" element={<BookingAccessBootstrapPage />} /><Route path="/recover/:publicIdentifier" element={<BookingRecoveryPage />} /><Route path="/recover/appointment/:publicIdentifier" element={<LegacyRecoveryRedirect />} /><Route path="/recover/group/:publicIdentifier" element={<LegacyRecoveryRedirect />} /><Route path="/patient-bookings/:bookingReference" element={<PatientAppointmentPage />} /><Route path="/patient-booking-groups" element={<PatientBookingGroupPage />} /><Route path="/login" element={<LoginPage />} /><Route path="/register" element={<DoctorRegistrationPage />} /><Route path="/register/doctor" element={<Navigate to="/register" replace />} /><Route path="/secretary-invitation" element={<SecretaryInvitationPage />} /><Route path="/secretary-replacement-invitation" element={<SecretaryReplacementInvitationPage />} /><Route path="/verify-email" element={<VerifyEmailPage />} /><Route path="/forgot-password" element={<ForgotPasswordPage />} /><Route path="/reset-password" element={<ResetPasswordPage />} /><Route path="/account/disabled" element={<DisabledAccountPage />} /><Route path="/account/reactivate" element={<ReactivateAccountPage />} /><Route path="/account/permanent-close" element={<PermanentCloseAccountPage />} />
    <Route element={<ProtectedRoute />}><Route element={<AppShell />}><Route path="/app" element={<WorkspacePage />} />
      <Route element={<ProtectedRoute allowedRoles={['DOCTOR']} />}><Route path="/app/practice-locations" element={<PracticeLocationsPage />} /><Route path="/app/practice-locations/:practiceLocationId" element={<PracticeLocationConfigurationPage />} /><Route path="/app/practice-locations/:practiceLocationId/services-questions" element={<ClinicServicesQuestionsPage />} /><Route path="/app/practice-locations/:practiceLocationId/staff" element={<SecretaryStaffingPage />} /><Route path="/app/secretary-draft-reviews" element={<SecretaryDraftReviewsPage />} /><Route path="/app/secretary-draft-reviews/:draftId" element={<SecretaryDraftReviewPage />} /><Route path="/app/defaults" element={<DoctorDefaultsPage />} /><Route path="/app/data-privacy" element={<DoctorDataPrivacyPage />} /></Route>
      <Route element={<ProtectedRoute allowedRoles={['SECRETARY']} />}><Route path="/app/secretary/clinics" element={<SecretaryClinicsPage />} /><Route path="/app/secretary/settings-drafts/:draftId" element={<SecretarySettingsDraftPage />} /></Route>
      <Route element={<ProtectedRoute allowedRoles={['DOCTOR', 'SECRETARY']} />}><Route path="/app/account" element={<AccountSecurityPage />} /></Route>
    </Route></Route><Route path="*" element={<NotFound />} />
  </Routes>;
}
