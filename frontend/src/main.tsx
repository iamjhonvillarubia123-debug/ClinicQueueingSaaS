import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import './styles/global.css';
import './styles/account-lifecycle.css';
import './styles/account-entry.css';
import './styles/sign-in.css';
import './styles/patient.css';
import './styles/doctor.css';
import './styles/clinic.css';
import './styles/clinic-schedule-actions.css';
import './styles/clinic-list-actions.css';
import './styles/clinic-operations.css';
import './styles/clinic-staff.css';
import './styles/secretary-invitation.css';
import './styles/queue-action-drawer.css';
import './styles/appointment-details.css';
import './styles/service-date-control.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
