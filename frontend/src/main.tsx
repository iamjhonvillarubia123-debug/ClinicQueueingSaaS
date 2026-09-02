import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import './styles/global.css';
import './styles/account-lifecycle.css';
import './styles/sign-in.css';
import './styles/password-recovery.css';
import './styles/reactivate-account.css';
import './styles/create-account.css';
import './styles/post-registration.css';
import './styles/patient.css';
import './styles/doctor.css';
import './styles/clinic.css';
import './styles/clinic-schedule-actions.css';
import './styles/clinic-list-actions.css';
import './styles/clinic-operations.css';
import './styles/clinic-staff.css';
import './styles/secretary-invitation.css';
import './styles/secretary-workspace.css';
import './styles/queue-action-drawer.css';
import './styles/appointment-details.css';
import './styles/service-date-control.css';
import './styles/doctor-calendar.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
