import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { VerifyEmailPage } from './auth/AccountAccessPages';
import {
  ForgotPasswordPage,
  ResetPasswordPage,
} from './auth/PasswordRecoveryPages';
import {
  AccountSecurityPage,
  DisabledAccountPage,
  PermanentCloseAccountPage,
  ReactivateAccountPage,
} from './auth/AccountLifecyclePages';
import { CreateAccountPage } from './auth/CreateAccountPage';
import {
  DoctorOnboardingPage,
  RegistrationAccountReadyPage,
  RegistrationCheckEmailPage,
  SecretaryNoAssignmentsPage,
} from './auth/PostRegistrationPages';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { IndividualBookingPage } from './booking/IndividualBookingPage';
import { MultiPersonBookingPage } from './booking/MultiPersonBookingPage';
import { AuthoritativeClinicOperationsRoutePage } from './doctor/AuthoritativeClinicOperationsRoutePage';
import { DoctorBillingPage } from './doctor/DoctorBillingPage';
import { DoctorCalendarPage } from './doctor/DoctorCalendarPage';
import { DoctorProfilePage } from './doctor/DoctorProfilePage';
import { DoctorReportsPage } from './doctor/DoctorReportsPage';
import { DoctorSettingsPage } from './doctor/DoctorSettingsPage';
import { ClinicTabPage } from './doctor/ClinicTab';
import {
  DoctorOnly,
  DoctorWorkspacePlaceholder,
  DoctorWorkspaceShell,
} from './doctor/DoctorWorkspace';
import { GlobalSecretariesPage } from './doctor/GlobalSecretariesPage';
import { SecretaryInvitationAcceptancePage } from './secretary/SecretaryInvitationAcceptancePage';
import { SecretaryProfilePage } from './secretary/SecretaryProfilePage';
import { SecretaryReportsPage } from './secretary/SecretaryReportsPage';
import {
  SecretaryOnly,
  SecretaryWorkspacePlaceholder,
  SecretaryWorkspaceShell,
} from './secretary/SecretaryWorkspace';
import {
  SecretaryClinicsPage,
  SecretaryClinicWorkspacePage,
  SecretaryInvitationsPage,
} from './secretary/SecretaryWorkspacePages';
import { BookingAccessBootstrapPage } from './patient/BookingAccessBootstrapPage';
import { BookingRecoveryPage } from './patient/BookingRecoveryPage';
import { PatientAppointmentPage } from './patient/PatientAppointmentPage';
import { PatientBookingGroupPage } from './patient/PatientBookingGroupPage';
import {
  DoctorPublicPage,
  PracticeLocationPublicPage,
} from './public/PublicPages';

function LandingPage() {
  return (
    <main className="public-page">
      <nav className="topbar" aria-label="Primary">
        <span className="brand">Clinic Queueing</span>
        <Link to="/login">Staff sign in</Link>
      </nav>
      <section className="hero">
        <p className="eyebrow">Simple clinic queues</p>
        <h1>Less waiting around. More clarity.</h1>
        <p>
          Open a Doctor or clinic public link to view practice information and
          begin booking.
        </p>
      </section>
    </main>
  );
}

function LegacyShell() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  const canManageOwnLifecycle =
    profile?.role === 'DOCTOR' || profile?.role === 'SECRETARY';

  return (
    <div className="shell">
      <header className="appbar">
        <Link className="brand" to="/">
          Clinic Queueing
        </Link>
        <div>
          <span className="role">{profile?.role.replace('_', ' ')}</span>
          {canManageOwnLifecycle ? (
            <Link className="quiet-link account-nav-link" to="/app/account">
              Account
            </Link>
          ) : null}
          <button className="secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="workspace">
        <Outlet />
      </main>
    </div>
  );
}

function WorkspaceEntryPage() {
  const { profile } = useAuth();

  if (profile?.role === 'DOCTOR') {
    return <Navigate to="/app/overview" replace />;
  }
  if (profile?.role === 'SECRETARY') {
    return <Navigate to="/app/secretary" replace />;
  }

  return (
    <section className="intro">
      <p className="eyebrow">Foundation ready</p>
      <h1>System administration</h1>
      <p>
        Restricted administrative operations will remain separate from clinic
        navigation.
      </p>
    </section>
  );
}

function LegacyRecoveryRedirect() {
  const { publicIdentifier } = useParams();
  return (
    <Navigate
      to={
        publicIdentifier
          ? `/recover/${encodeURIComponent(publicIdentifier)}`
          : '/'
      }
      replace
    />
  );
}

function NotFound() {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">404</p>
        <h1>Page not found</h1>
        <p>The link may be incorrect or no longer available.</p>
        <Link className="link-button" to="/">
          Return home
        </Link>
      </section>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/public/doctors/:publicIdentifier" element={<DoctorPublicPage />} />
      <Route path="/public/practice-locations/:publicIdentifier" element={<PracticeLocationPublicPage />} />
      <Route path="/book/:publicIdentifier" element={<IndividualBookingPage />} />
      <Route path="/book/:publicIdentifier/group" element={<MultiPersonBookingPage />} />
      <Route path="/booking/access" element={<BookingAccessBootstrapPage />} />
      <Route path="/recover/:publicIdentifier" element={<BookingRecoveryPage />} />
      <Route path="/recover/appointment/:publicIdentifier" element={<LegacyRecoveryRedirect />} />
      <Route path="/recover/group/:publicIdentifier" element={<LegacyRecoveryRedirect />} />
      <Route path="/patient-bookings/:bookingReference" element={<PatientAppointmentPage />} />
      <Route path="/patient-booking-groups" element={<PatientBookingGroupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<CreateAccountPage />} />
      <Route path="/register/doctor" element={<Navigate to="/register" replace />} />
      <Route path="/registration/check-email" element={<RegistrationCheckEmailPage />} />
      <Route path="/registration/account-ready" element={<RegistrationAccountReadyPage />} />
      <Route path="/registration/doctor-onboarding" element={<DoctorOnboardingPage />} />
      <Route path="/registration/secretary-home" element={<SecretaryNoAssignmentsPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/account/disabled" element={<DisabledAccountPage />} />
      <Route path="/account/reactivate" element={<ReactivateAccountPage />} />
      <Route path="/account/permanent-close" element={<PermanentCloseAccountPage />} />
      <Route path="/secretary-invitations/accept" element={<SecretaryInvitationAcceptancePage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<LegacyShell />}>
          <Route path="/app" element={<WorkspaceEntryPage />} />
          <Route path="/app/account" element={<AccountSecurityPage />} />
        </Route>

        <Route element={<DoctorOnly />}>
          <Route element={<DoctorWorkspaceShell />}>
            <Route path="/app/overview" element={<DoctorWorkspacePlaceholder title="Overview" description="Your clinic overview will appear here once the approved workspace content is designed and connected." />} />
            <Route path="/app/profile" element={<DoctorProfilePage />} />
            <Route path="/app/clinics" element={<ClinicTabPage />} />
            <Route path="/app/clinics/:clinicId/operations" element={<AuthoritativeClinicOperationsRoutePage />} />
            <Route path="/app/calendar" element={<DoctorCalendarPage />} />
            <Route path="/app/secretaries" element={<GlobalSecretariesPage />} />
            <Route path="/app/reports" element={<DoctorReportsPage />} />
            <Route path="/app/settings" element={<DoctorSettingsPage />} />
            <Route path="/app/billing" element={<DoctorBillingPage />} />
          </Route>
        </Route>

        <Route element={<SecretaryOnly />}>
          <Route element={<SecretaryWorkspaceShell />}>
            <Route path="/app/secretary" element={<Navigate to="/app/secretary/overview" replace />} />
            <Route path="/app/secretary/overview" element={<SecretaryWorkspacePlaceholder title="Overview" description="Your Secretary overview will be designed and connected here later." />} />
            <Route path="/app/secretary/profile" element={<SecretaryProfilePage />} />
            <Route path="/app/secretary/clinics" element={<SecretaryClinicsPage />} />
            <Route path="/app/secretary/clinics/:clinicId" element={<SecretaryClinicWorkspacePage />} />
            <Route path="/app/secretary/invitations" element={<SecretaryInvitationsPage />} />
            <Route path="/app/secretary/reports" element={<SecretaryReportsPage />} />
            <Route path="/app/secretary/settings" element={<SecretaryWorkspacePlaceholder title="Settings" description="Secretary profile and account settings will be designed here next." />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
