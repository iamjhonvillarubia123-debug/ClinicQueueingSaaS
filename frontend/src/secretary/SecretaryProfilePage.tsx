import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import type { SecretaryWorkspaceData } from './SecretaryWorkspacePages';
import './SecretaryProfilePage.css';

function Field({ label, placeholder, wide = false }: { label: string; placeholder: string; wide?: boolean }) {
  return <label className={wide ? 'secretary-profile-field is-wide' : 'secretary-profile-field'}><span>{label}</span><input value="" placeholder={placeholder} readOnly aria-label={label} title="Profile editing backend is not connected yet" /></label>;
}

export function SecretaryProfilePage() {
  const [workspace, setWorkspace] = useState<SecretaryWorkspaceData | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void apiRequest<SecretaryWorkspaceData>('/secretary/workspace')
      .then((data) => { if (active) setWorkspace(data); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, []);

  const clinics = workspace?.clinics ?? [];

  return <div className="secretary-profile-page">
    <div className="secretary-profile-main">
      <header className="secretary-profile-heading">
        <h1>Secretary Profile</h1>
        <p>Manage information about yourself that Doctors you work with can see.</p>
      </header>

      <section className="secretary-profile-hero">
        <div className="secretary-profile-avatar" aria-hidden="true">S<span>▣</span></div>
        <div className="secretary-profile-identity">
          <h2>Secretary account</h2>
          <strong>Clinic Secretary</strong>
          <p>Account identity details are not exposed by the current Secretary profile API.</p>
        </div>
        <div className="secretary-profile-privacy"><b>▣ Internal Use Only</b><p>Profile information visible to assigned Doctors only.</p></div>
      </section>

      <section className="secretary-profile-card">
        <div className="secretary-profile-card-title"><span>1</span><div><h3>Personal Information</h3><p>Information from your account will be filled once the profile read API is connected.</p></div></div>
        <div className="secretary-profile-fields">
          <Field label="First Name" placeholder="Not connected" />
          <Field label="Middle Name (Optional)" placeholder="Not connected" />
          <Field label="Last Name" placeholder="Not connected" />
          <label className="secretary-profile-field"><span>Suffix (Optional)</span><select aria-label="Suffix (Optional)" disabled><option>Select</option></select></label>
          <Field label="Preferred Name (Optional)" placeholder="e.g. Maria" />
          <Field label="Job Title / Position (Optional)" placeholder="Clinic Secretary" />
        </div>
      </section>

      <section className="secretary-profile-card">
        <div className="secretary-profile-card-title"><span>2</span><div><h3>About Me <small>(Optional)</small></h3><p>Add a short introduction about yourself and your experience.</p></div></div>
        <textarea aria-label="About Me" maxLength={1000} placeholder="Tell Doctors a little about yourself..." readOnly title="Profile editing backend is not connected yet" />
        <div className="secretary-profile-counter">0/1000</div>
      </section>

      <div className="secretary-profile-split">
        <section className="secretary-profile-card">
          <div className="secretary-profile-card-title"><span>3</span><div><h3>Work Information <small>(Optional)</small></h3><p>Share your background and skills related to clinic work.</p></div></div>
          <div className="secretary-profile-fields two-col">
            <label className="secretary-profile-field"><span>Years of Clinic Experience</span><select aria-label="Years of Clinic Experience" disabled><option>Select</option></select></label>
            <Field label="Languages" placeholder="e.g. English, Filipino, Cebuano" />
          </div>
          <div className="secretary-profile-skills"><strong>Professional / Administrative Skills <small>(Optional)</small></strong><button type="button" disabled title="Skills persistence is not connected yet">＋ Add Skill</button></div>
        </section>

        <section className="secretary-profile-card">
          <div className="secretary-profile-card-title"><span>4</span><div><h3>Clinic Connections</h3><p>Clinics where you currently have an assignment.</p></div></div>
          {loadError ? <p className="secretary-profile-warning" role="status">Clinic connections could not be loaded.</p> : null}
          <div className="secretary-profile-clinics">
            {clinics.length ? clinics.map((clinic) => <div className="secretary-profile-clinic" key={clinic.practiceStaffId}><span className="clinic-thumb">+</span><div><strong>{clinic.clinicName}</strong><small>Dr. {clinic.doctorName}</small><small>⌖ {clinic.address || 'Location not provided'}</small></div><b className={clinic.status === 'ACTIVE' ? 'active' : 'disabled'}>{clinic.status === 'ACTIVE' ? 'Active' : 'Disabled'}</b></div>) : <p className="secretary-profile-empty">No clinic connections.</p>}
          </div>
          <p className="secretary-profile-note">ⓘ Clinic connections are managed by your Doctor. You cannot add or remove clinics here.</p>
        </section>
      </div>

      <div className="secretary-profile-banner">ⓘ Your profile is not public. Optional profile information is available only within authorized clinic relationships.</div>
    </div>

    <aside className="secretary-profile-side">
      <section><h3>Your Profile</h3><div className="profile-check done"><i>✓</i><div><strong>Account information</strong><p>Email and contact details</p></div></div><div className="profile-check"><i /><div><strong>Profile photo <small>Optional</small></strong><p>Add a photo to help Doctors recognize you.</p></div></div><div className="profile-check"><i /><div><strong>About me <small>Optional</small></strong><p>Tell Doctors a little about yourself.</p></div></div><div className="profile-check"><i /><div><strong>Work information <small>Optional</small></strong><p>Add your experience, languages and skills.</p></div></div><div className="secretary-profile-info">ⓘ <b>All additional information is optional.</b><p>Completing more information helps Doctors know you better.</p></div></section>
      <section><h3>Who Can See This?</h3><div className="secretary-profile-who"><span>♙</span><p>Doctors you currently work with can view your profile information through their Staff and Clinic workspaces.</p></div></section>
      <section><h3>Need Help?</h3><p>Learn how your profile works and how it is used within the system.</p><button type="button" disabled title="Profile guide is not connected yet">View Profile Guide ↗</button></section>
    </aside>
  </div>;
}
