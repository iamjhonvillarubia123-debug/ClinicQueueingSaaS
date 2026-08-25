import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import './styles/global.css';
import './styles/account-lifecycle.css';
import './styles/patient.css';
import './styles/practice-admin.css';
import './styles/clinic-activation.css';
import './styles/secretary-access.css';
import './styles/secretary-proposal.css';
import './styles/secretary-question-controls.css';
import './styles/secretary-content-section.css';
import './styles/secretary-schedule-approved.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);