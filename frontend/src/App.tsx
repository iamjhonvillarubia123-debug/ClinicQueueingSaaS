import { FormEvent, useState } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { ApiError } from './api/client';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { IndividualBookingPage } from './booking/IndividualBookingPage';
import { MultiPersonBookingPage } from './booking/MultiPersonBookingPage';
import { AuthoritativeClinicOperationsRoutePage } from './doctor/AuthoritativeClinicOperationsRoutePage';
import { ClinicTabPage } from './doctor/ClinicTab';
import {
  DoctorOnly,
  DoctorWorkspacePlaceholder,
  DoctorWorkspaceShell,
} from './doctor/DoctorWorkspace';
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

function LoginPage() {
  const { status, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (status === 'authenticated') return <Navigate to="/app" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || '/app', { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Unable to sign in. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="signin-heading">
        <Link className="brand" to="/">
          Clinic Queueing
        </Link>
        <div className="auth-heading">
          <h1 id="signin-heading">Sign in</h1>
          <p>For doctors, secretaries, and authorized system staff.</p>
        </div>
        <form className="stack" onSubmit={submit} noValidate>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <button
            className="primary"
            type="submit"
            disabled={submitting || !email || !password}
          >
            {submitting ? 'Signing in…' : 'Continue'}
          </button>
        </form>
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

  return (
    <div className="shell">
      <header className="appbar">
        <Link className="brand" to="/">
          Clinic Queueing
        </Link>
        <div>
          <span className="role">{profile?.role.replace('_', ' ')}</span>
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

  const copy =
    profile?.role === 'SECRETARY'
      ? [
          'Secretary workspace',
          'Fast assigned-clinic operations will be built here.',
        ]
      : [
          'System administration',
          'Restricted administrative operations will remain separate from clinic navigation.',
        ];
  return (
    <section className="intro">
      <p className="eyebrow">Foundation ready</p>
      <h1>{copy[0]}</h1>
      <p>{copy[1]}</p>
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
      <Route
        path="/public/doctors/:publicIdentifier"
        element={<DoctorPublicPage />}
      />
      <Route
        path="/public/practice-locations/:publicIdentifier"
        element={<PracticeLocationPublicPage />}
      />
      <Route path="/book/:publicIdentifier" element={<IndividualBookingPage />} />
      <Route
        path="/book/:publicIdentifier/group"
        element={<MultiPersonBookingPage />}
      />
      <Route path="/booking/access" element={<BookingAccessBootstrapPage />} />
      <Route path="/recover/:publicIdentifier" element={<BookingRecoveryPage />} />
      <Route
        path="/recover/appointment/:publicIdentifier"
        element={<LegacyRecoveryRedirect />}
      />
      <Route
        path="/recover/group/:publicIdentifier"
        element={<LegacyRecoveryRedirect />}
      />
      <Route
        path="/patient-bookings/:bookingReference"
        element={<PatientAppointmentPage />}
      />
      <Route
        path="/patient-booking-groups"
        element={<PatientBookingGroupPage />}
      />
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<LegacyShell />}>
          <Route path="/app" element={<WorkspaceEntryPage />} />
        </Route>

        <Route element={<DoctorOnly />}>
          <Route element={<DoctorWorkspaceShell />}>
            <Route
              path="/app/overview"
              element={
                <DoctorWorkspacePlaceholder
                  title="Overview"
                  description="Your clinic overview will appear here once the approved workspace content is designed and connected."
                />
              }
            />
            <Route
              path="/app/profile"
              element={
                <DoctorWorkspacePlaceholder
                  title="Profile"
                  description="Your approved doctor profile interface will be connected here in the profile implementation slice."
                />
              }
            />
            <Route path="/app/clinics" element={<ClinicTabPage />} />
            <Route
              path="/app/clinics/:clinicId/operations"
              element={<AuthoritativeClinicOperationsRoutePage />}
            />
            <Route
              path="/app/calendar"
              element={
                <DoctorWorkspacePlaceholder
                  title="Calendar"
                  description="Doctor-wide availability and calendar controls will be placed here after workflow review."
                />
              }
            />
            <Route
              path="/app/secretaries"
              element={
                <DoctorWorkspacePlaceholder
                  title="Secretaries"
                  description="Secretary invitations, assignments, and governance will be connected here in its approved workflow slice."
                />
              }
            />
            <Route
              path="/app/settings"
              element={
                <DoctorWorkspacePlaceholder
                  title="Settings"
                  description="Doctor profile, account settings, privacy, and approved configuration areas will be organized here after review."
                />
              }
            />
            <Route
              path="/app/billing"
              element={
                <DoctorWorkspacePlaceholder
                  title="Billing"
                  description="Subscription and financial controls will be connected here when the billing frontend slice is implemented."
                />
              }
            />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
