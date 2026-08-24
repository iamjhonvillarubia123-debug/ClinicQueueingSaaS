import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type UserRole } from './AuthContext';

export function ProtectedRoute({ allowedRoles }: { allowedRoles?: readonly UserRole[] }) {
  const { status, profile } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <main className="centered-page" aria-live="polite"><p>Checking your session…</p></main>;
  }
  if (status === 'anonymous' || !profile) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/app" replace />;
  }
  return <Outlet />;
}
