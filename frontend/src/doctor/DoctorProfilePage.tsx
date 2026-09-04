import './DoctorProfilePage.css';

const profileChecklist = [
  'Professional information',
  'Profile photo',
  'About me',
  'Specialization',
  'License number',
  'Clinics & contact',
  'Services & pricing',
];

function Icon({ name }: { name: 'location' | 'mail' | 'phone' | 'eye' | 'copy' | 'qr' | 'print' | 'camera' | 'lock' | 'check' | 'share' | 'shield' | 'help' }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'location': return <svg {...common}><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></svg>;
    case 'mail': return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
    case 'phone': return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1A19.5 19.5 0 0 1 5.2 12 19.8 19.8 0 0 1 2.1 3.4 2 2 0 0 1 4.1 1.2h3A2 2 0 0 1 9 2.9l.7 3a2 2 0 0 1-.5 1.9L8 9a16 16 0 0 0 7 7l1.2-1.2a2 2 0 0 1 1.9-.5l3 .7a2 2 0 0 1 1.7 1.9Z" /></svg>;
    case 'eye': return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case 'copy': return <svg {...common}><rect x="9" y="9" width="10" height="10" rx="2" /><rect x="5" y="5" width="10" height="10" rx="2" /></svg>;
    case 'qr': return <svg {...common}><rect x="3" y="3" width="6" height="6" /><rect x="15" y="3" width="6" height="6" /><rect x="3" y="15" width="6" height="6" /><path d="M15 15h2v2h-2zM19 15h2v6h-2M15 19h2v2h-2" /></svg>;
    case 'print': return <svg {...common}><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" /></svg>;
    case 'camera': return <svg {...common}><path d="M4 7h3l1.5-2h7L17 7h3a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="3" /></svg>;
    case 'lock': return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
    case 'check': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></svg>;
    case 'share': return <svg {...common}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6" /></svg>;
    case 'shield': return <svg {...common}><path d="M12 3 20 6v5c0 5-3.3 8.4-8 10-4.7-1.6-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
    case 'help': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.6 2.1c-.9.5-1.4 1-1.4 2M12 17h.01" /></svg>;
  }
}

export function DoctorProfilePage() {
  return (
    <div className="doctor-profile-page">
      <div className="doctor-profile-main">
        <header className="doctor-profile-heading">
          <h1>Professional Profile</h1>
          <p>Manage your professional information and how you appear to patients.</p>
        </header>

        <section className="doctor-profile-hero">
          <div className="doctor-profile-photo" aria-label="Profile photo placeholder">
            <span>DR</span>
            <button type="button" className="doctor-profile-camera" aria-label="Change profile photo">
              <Icon name="camera" />
            </button>
          </div>
          <div className="doctor-profile-identity">
            <h2>Doctor account</h2>
            <strong>Specialization</strong>
            <p><Icon name="location" /> Main clinic</p>
            <p><Icon name="mail" /> Account email</p>
            <p><Icon name="phone" /> Mobile number</p>
          </div>
          <div className="doctor-profile-public-state">
            <span className="doctor-profile-status-pill"><Icon name="lock" /> Private</span>
            <p>Your public webpage is not published.</p>
            <button type="button" className="doctor-profile-secondary"><Icon name="eye" /> Preview Webpage</button>
          </div>
        </section>

        <section className="doctor-profile-card">
          <div className="doctor-profile-section-title">
            <span>1.</span>
            <div><h3>Professional Information</h3><p>Information from your account creation is already filled.</p></div>
          </div>
          <div className="doctor-profile-grid four">
            <label>First Name<input type="text" placeholder="First name" /></label>
            <label>Middle Name <span>(Optional)</span><input type="text" placeholder="Middle name" /></label>
            <label>Last Name<input type="text" placeholder="Last name" /></label>
            <label>Suffix <span>(Optional)</span><select defaultValue=""><option value="">Select suffix</option><option>Jr.</option><option>Sr.</option><option>III</option></select></label>
          </div>
          <div className="doctor-profile-grid two">
            <label>Professional Title<input type="text" placeholder="Doctor" /><small>e.g., Doctor, Medical Specialist</small></label>
            <label>Specialization<input type="text" placeholder="Your area of medical practice" /><small>Your area of medical practice</small></label>
          </div>
          <div className="doctor-profile-license-row">
            <label>License Number<div className="doctor-profile-inline-field"><input type="text" placeholder="Professional license number" readOnly /><button type="button">Change License</button></div><small>Your professional license number is used for verification.</small></label>
          </div>
        </section>

        <section className="doctor-profile-card">
          <div className="doctor-profile-section-title">
            <span>2.</span>
            <div><h3>About Me</h3><p>Write a short description about yourself and your approach to patient care.</p></div>
          </div>
          <label className="doctor-profile-full-label">Profile Description
            <textarea maxLength={2000} placeholder="Write a short professional description that patients can read on your public webpage." />
            <span className="doctor-profile-field-footer"><small>This description will appear on your public webpage.</small><small>Characters: 0/2000</small></span>
          </label>
        </section>

        <section className="doctor-profile-card doctor-profile-public-card">
          <div className="doctor-profile-section-title">
            <span>3.</span>
            <div><h3>Public Webpage</h3><p>Control your public profile visibility and access tools.</p></div>
          </div>
          <div className="doctor-profile-public-grid">
            <div>
              <label>Profile Address (URL)</label>
              <div className="doctor-profile-url-field"><span>clinicqueueing.com/dr/your-profile</span><button type="button"><Icon name="copy" /> Copy Link</button></div>
            </div>
            <div>
              <label>Status</label>
              <span className="doctor-profile-status-pill"><Icon name="lock" /> Private</span>
              <p>Your profile is not visible to patients yet.</p>
            </div>
          </div>
          <div className="doctor-profile-actions">
            <button type="button" className="doctor-profile-secondary"><Icon name="eye" /> Preview Webpage</button>
            <button type="button" className="doctor-profile-primary">◎ Publish Webpage</button>
            <button type="button" className="doctor-profile-secondary"><Icon name="qr" /> Generate QR</button>
            <button type="button" className="doctor-profile-secondary"><Icon name="print" /> Print Calling Card</button>
          </div>
        </section>
      </div>

      <aside className="doctor-profile-sidebar">
        <section className="doctor-profile-side-card">
          <h3>Profile Completeness</h3>
          <div className="doctor-profile-progress-row">
            <div className="doctor-profile-progress"><strong>80%</strong></div>
            <p>Complete your profile to publish your professional webpage.</p>
          </div>
          <div className="doctor-profile-checklist">
            {profileChecklist.map((item) => <div key={item}><span className="doctor-profile-check"><Icon name="check" /></span><span>{item}</span><em>Completed</em></div>)}
          </div>
          <div className="doctor-profile-tip"><strong>ⓘ &nbsp;Almost there!</strong><p>Add your clinics and services with pricing to complete your public profile.</p></div>
        </section>

        <section className="doctor-profile-side-card">
          <h3>Why publish your webpage?</h3>
          <div className="doctor-profile-benefit"><span><Icon name="check" /></span><p>Patients can learn about you and your services</p></div>
          <div className="doctor-profile-benefit"><span><Icon name="share" /></span><p>Share your profile link or QR code anywhere</p></div>
          <div className="doctor-profile-benefit"><span><Icon name="shield" /></span><p>Build trust with a professional online presence</p></div>
        </section>

        <section className="doctor-profile-side-card doctor-profile-help">
          <div className="doctor-profile-help-title"><span><Icon name="help" /></span><h3>Need Help?</h3></div>
          <p>Learn how your public profile works and how to share it with patients.</p>
          <button type="button" className="doctor-profile-secondary">View Profile Guide ↗</button>
        </section>
      </aside>
    </div>
  );
}
