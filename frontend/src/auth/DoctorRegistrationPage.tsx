import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

function messageFor(error: unknown) {
  return error instanceof ApiError ? error.message : 'Unable to create the account right now. Please try again.';
}

export function DoctorRegistrationPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [professionalTitle, setProfessionalTitle] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!password.trim()) {
      setError('Password must not be blank.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/doctor/register', {
        method: 'POST',
        body: {
          firstName,
          middleName: middleName || undefined,
          lastName,
          suffix: suffix || undefined,
          email,
          mobileNumber,
          professionalTitle,
          specialization,
          licenseNumber,
          password,
        },
      });
      navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`, {
        replace: true,
        state: { registrationComplete: true, accountType: 'DOCTOR' },
      });
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Link className="brand" to="/">Clinic Queueing</Link>
        <div className="auth-heading">
          <p className="eyebrow">Doctor account</p>
          <h1>Create your account</h1>
          <p>Public account creation is for Doctors. Secretaries join a clinic through a secure Doctor-issued invitation.</p>
        </div>
        <form className="stack auth-long-form" onSubmit={submit}>
          <div className="auth-field-grid">
            <label>First name<input required maxLength={100} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
            <label>Middle name <span className="optional">Optional</span><input maxLength={100} autoComplete="additional-name" value={middleName} onChange={(event) => setMiddleName(event.target.value)} /></label>
            <label>Last name<input required maxLength={100} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
            <label>Suffix <span className="optional">Optional</span><input maxLength={30} value={suffix} onChange={(event) => setSuffix(event.target.value)} /></label>
          </div>
          <label>Email<input type="email" required maxLength={255} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Mobile number<input type="tel" required maxLength={30} autoComplete="tel" placeholder="09… or +63…" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} /></label>
          <div className="auth-field-grid">
            <label>Professional title<input required maxLength={50} placeholder="e.g. Dr." value={professionalTitle} onChange={(event) => setProfessionalTitle(event.target.value)} /></label>
            <label>Specialization<input required maxLength={150} placeholder="e.g. Family Medicine" value={specialization} onChange={(event) => setSpecialization(event.target.value)} /></label>
          </div>
          <label>Professional license number<input required maxLength={100} value={licenseNumber} onChange={(event) => setLicenseNumber(event.target.value)} /></label>
          <label>Password<input type="password" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Confirm password<input type="password" required autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create Doctor account'}</button>
          <p className="auth-footnote">Already have an account? <Link to="/login">Sign in</Link></p>
        </form>
      </section>
    </main>
  );
}
