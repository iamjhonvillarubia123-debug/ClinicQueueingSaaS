import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../api/client';
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

type PracticeLocationResponse = {
  id: string;
  publicIdentifier: string;
  lifecycleStatus: 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'PERMANENTLY_DELETED';
  name: string | null;
  addressLine1: string | null;
  cityMunicipality?: string | null;
  province?: string | null;
  contactNumber: string | null;
  clinicEmail?: string | null;
  services?: Array<{ id: string; name: string; status: 'ACTIVE' | 'INACTIVE' }>;
};

type DoctorIdentity = {
  publicIdentifier: string;
  publicSlug: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  professionalTitle: string;
  specialization: string;
  profileDescription: string | null;
  profilePhotoUrl: string | null;
  profilePhotoZoom?: number;
  profilePhotoX?: number;
  profilePhotoY?: number;
};

type DoctorProfileStateResponse = {
  onboardingComplete: boolean;
  user: {
    email?: string | null;
    mobileNumber?: string | null;
    firstName: string;
    middleName: string | null;
    lastName: string;
  };
  profile: {
    id: string;
    middleName: string | null;
    suffix: string | null;
    professionalTitle: string;
    specialization: string;
    licenseNumber: string;
    profileDescription: string | null;
    profilePhotoUrl: string | null;
  profilePhotoZoom?: number;
  profilePhotoX?: number;
  profilePhotoY?: number;
    publicIdentifier: string;
    publicSlug: string | null;
    isProfilePublic: boolean;
  } | null;
};

type PublicationState = 'loading' | 'published' | 'private' | 'unknown';

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
    case 'check': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2 2 4-4" /></svg>;
    case 'share': return <svg {...common}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6" /></svg>;
    case 'shield': return <svg {...common}><path d="M12 3 20 6v5c0 5-3.3 8.4-8 10-4.7-1.6-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
    case 'help': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.6 2.1c-.9.5-1.4 1-1.4 2M12 17h.01" /></svg>;
  }
}

function profileName(doctor: DoctorIdentity | null) {
  if (!doctor) return 'Doctor account';
  return [doctor.professionalTitle, doctor.firstName, doctor.middleName, doctor.lastName, doctor.suffix]
    .filter(Boolean)
    .join(' ');
}


function profileInitials(doctor: DoctorIdentity | null, firstName: string, lastName: string) {
  if (doctor) return `${doctor.firstName.charAt(0)}${doctor.lastName.charAt(0)}`.toUpperCase();
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  return initials || 'DR';
}

function identityFromProfileState(state: DoctorProfileStateResponse): DoctorIdentity | null {
  if (!state.profile) return null;
  return {
    publicIdentifier: state.profile.publicIdentifier,
    publicSlug: state.profile.publicSlug,
    firstName: state.user.firstName,
    middleName: state.profile.middleName,
    lastName: state.user.lastName,
    suffix: state.profile.suffix,
    professionalTitle: state.profile.professionalTitle,
    specialization: state.profile.specialization,
    profileDescription: state.profile.profileDescription,
    profilePhotoUrl: state.profile.profilePhotoUrl,
    profilePhotoZoom: state.profile.profilePhotoZoom ?? 1,
    profilePhotoX: state.profile.profilePhotoX ?? 50,
    profilePhotoY: state.profile.profilePhotoY ?? 50,
  };
}

export function DoctorProfilePage() {
  const [doctor, setDoctor] = useState<DoctorIdentity | null>(null);
  const [activeClinics, setActiveClinics] = useState(0);
  const [accountContact, setAccountContact] = useState<{ email: string | null; phone: string | null }>({ email: null, phone: null });
  const [preview, setPreview] = useState(false);
  const [presentationBusy, setPresentationBusy] = useState(false);
  const [presentationError, setPresentationError] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const photoDrag = useRef<{ x: number; y: number; startX: number; startY: number; overflowX: number; overflowY: number } | null>(null);
  const photoPosition = useRef({ x: 50, y: 50 });
  const [positionMessage, setPositionMessage] = useState('');
  const [profileUrl, setProfileUrl] = useState<string | null>(null);
  const [publicationState, setPublicationState] = useState<PublicationState>('loading');
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [professionalTitle, setProfessionalTitle] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    let active = true;

    async function loadProfileAndClinicData() {
      try {
        const profileState = await apiRequest<DoctorProfileStateResponse>('/doctor/profile');
        if (!active) return;

        setOnboardingComplete(profileState.onboardingComplete);
        setFirstName(profileState.user.firstName);
        setMiddleName(profileState.profile?.middleName ?? profileState.user.middleName ?? '');
        setLastName(profileState.user.lastName);
        setSuffix(profileState.profile?.suffix ?? '');
        setProfessionalTitle(profileState.profile?.professionalTitle ?? '');
        setSpecialization(profileState.profile?.specialization ?? '');
        setLicenseNumber(profileState.profile?.licenseNumber ?? '');
        setDescription(profileState.profile?.profileDescription ?? '');

        const authenticatedDoctor = identityFromProfileState(profileState);
        setDoctor(authenticatedDoctor);

        setAccountContact({ email: profileState.user.email ?? null, phone: profileState.user.mobileNumber ?? null });
        setPublicationState(profileState.profile?.isProfilePublic ? 'published' : 'private');
        setProfileUrl(profileState.profile ? `${window.location.origin}/public/doctors/${profileState.profile.publicIdentifier}` : null);
        const locations = await apiRequest<PracticeLocationResponse[]>('/practice-location');
        if (!active) return;
        setActiveClinics(locations.filter((location) => location.lifecycleStatus === 'ACTIVE').length);

      } catch {
        if (!active) return;
        setLoadError(true);
        setPublicationState('unknown');
      }
    }

    void loadProfileAndClinicData();
    return () => { active = false; };
  }, []);

  const isPublished = publicationState === 'published';
  const isOnboarding = onboardingComplete === false;
  const publicStatusLabel = publicationState === 'loading'
    ? 'Checking…'
    : publicationState === 'published'
      ? 'Public'
      : publicationState === 'private'
        ? 'Private'
        : 'Unavailable';

  const publicStatusCopy = isOnboarding
    ? 'Complete your professional profile before publishing your webpage.'
    : publicationState === 'published'
      ? 'Your public webpage is visible to patients.'
      : publicationState === 'private'
        ? 'Your public webpage is not published.'
        : publicationState === 'loading'
          ? 'Checking your public webpage status.'
          : 'Public webpage status is not available right now.';

  function previewWebpage() { setPreview(true); }

  async function updatePresentation(body: { profilePhotoZoom?: number; profilePhotoUrl?: string; profilePhotoX?: number; profilePhotoY?: number; isProfilePublic?: boolean }) {
    setPresentationBusy(true); setPresentationError('');
    try {
      const state = await apiRequest<DoctorProfileStateResponse>('/doctor/profile/presentation', { method: 'PATCH', body });
      setDoctor(identityFromProfileState(state));
      setPublicationState(state.profile?.isProfilePublic ? 'published' : 'private');
      if (body.profilePhotoZoom !== undefined || body.profilePhotoX !== undefined || body.profilePhotoY !== undefined) setPositionMessage('Photo framing saved.');
    } catch (error) { setPresentationError(error instanceof Error ? error.message : 'Unable to save profile.'); }
    finally { setPresentationBusy(false); }
  }

  async function uploadPhoto(file?: File) {
    if (!file) return;
    setPresentationError('');
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) { setPresentationError('Choose a JPG or PNG up to 5 MB.'); return; }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d'); if (!context) throw new Error('Image processing unavailable');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL('image/jpeg', .8);
      if (photo.length > 400000) throw new Error('Choose a smaller image.');
      await updatePresentation({ profilePhotoUrl: photo, profilePhotoZoom: 1, profilePhotoX: 50, profilePhotoY: 50 });
    } catch { setPresentationError('Could not upload this photo. Try another JPG or PNG.'); }
    finally { URL.revokeObjectURL(url); }
  }

  async function copyProfileLink() {
    if (!profileUrl || !navigator.clipboard) return;
    await navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function saveInitialProfessionalProfile() {
    if (savingOnboarding || !isOnboarding) return;
    setSaveError('');
    setSaveMessage('');

    if (!firstName.trim() || !lastName.trim() || !professionalTitle.trim() || !specialization.trim() || !licenseNumber.trim()) {
      setSaveError('Complete all required professional information before saving your profile.');
      return;
    }

    setSavingOnboarding(true);
    try {
      const completed = await apiRequest<DoctorProfileStateResponse>('/doctor/profile/onboarding', {
        method: 'POST',
        body: {
          firstName,
          middleName,
          lastName,
          suffix,
          professionalTitle,
          specialization,
          licenseNumber,
          profileDescription: description,
        },
      });
      setOnboardingComplete(true);
      setDoctor(identityFromProfileState(completed));
      setLicenseNumber(completed.profile?.licenseNumber ?? licenseNumber.trim());
      setSaveMessage('Professional profile saved. You can now create and configure your clinic.');
      setPublicationState('private');
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : 'Unable to save your professional profile right now.');
    } finally {
      setSavingOnboarding(false);
    }
  }

  if (preview) return <section className="doctor-webpage-preview">
    <header><button type="button" className="doctor-profile-secondary" onClick={() => setPreview(false)}>Back to Profile</button><span>Webpage Preview · {isPublished ? 'Public' : 'Private'}</span><button type="button" className="doctor-profile-primary" disabled={presentationBusy || !onboardingComplete} onClick={() => void updatePresentation({ isProfilePublic: !isPublished })}>{presentationBusy ? 'Saving…' : isPublished ? 'Unpublish Webpage' : 'Publish Webpage'}</button></header>
    {!onboardingComplete ? <p>Complete and save your professional information before publishing.</p> : null}
    {presentationError ? <p role="alert">{presentationError}</p> : null}
    <div className="doctor-webpage-blank" aria-label="Blank webpage preview" />
  </section>;

  return (
    <div className="doctor-profile-page">
      <div className="doctor-profile-main">
        <header className="doctor-profile-heading">
          <h1>Professional Profile</h1>
          <p>Manage your professional information and how you appear to patients.</p>
          {isOnboarding ? <p className="doctor-profile-onboarding-note" role="status">Complete the required professional information below. Your profile remains private until you choose to publish it later.</p> : null}
          {loadError ? <p className="doctor-profile-load-note" role="status">Your authenticated Doctor profile could not be loaded. Try again before changing professional information.</p> : null}
        </header>

        {positionMessage ? <p role="status" className="doctor-photo-save-status">{positionMessage}</p> : null}
        {presentationError ? <p role="alert">{presentationError}</p> : null}
        <section className="doctor-profile-hero">
          <div className="doctor-profile-photo-editor">
          <div className="doctor-profile-photo" aria-label="Profile photo">
            <div className="doctor-profile-photo-frame">
            {doctor?.profilePhotoUrl ? <img src={doctor.profilePhotoUrl} alt="Doctor profile photo" draggable={false}
              className="doctor-profile-draggable-photo" style={{ objectPosition: `${doctor.profilePhotoX ?? 50}% ${doctor.profilePhotoY ?? 50}%`, transform: `scale(${doctor.profilePhotoZoom ?? 1})`, transformOrigin: `${doctor.profilePhotoX ?? 50}% ${doctor.profilePhotoY ?? 50}%` }}
              tabIndex={0} role="img" aria-label="Profile photo. Drag to reposition, or use arrow keys." title="Drag to position your photo"
              onPointerDown={(event) => {
                if (presentationBusy || event.button !== 0) return;
                const image = event.currentTarget;
                const box = image.parentElement!.getBoundingClientRect();
                const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight) * (doctor.profilePhotoZoom ?? 1);
                photoPosition.current = { x: doctor.profilePhotoX ?? 50, y: doctor.profilePhotoY ?? 50 };
                photoDrag.current = { x: event.clientX, y: event.clientY, startX: photoPosition.current.x, startY: photoPosition.current.y, overflowX: image.naturalWidth * scale - box.width, overflowY: image.naturalHeight * scale - box.height };
                image.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = photoDrag.current; if (!drag) return;
                const clamp = (value: number) => Math.max(0, Math.min(100, value));
                const x = drag.overflowX > 0.5 ? clamp(drag.startX - (event.clientX - drag.x) * 100 / drag.overflowX) : drag.startX;
                const y = drag.overflowY > 0.5 ? clamp(drag.startY - (event.clientY - drag.y) * 100 / drag.overflowY) : drag.startY;
                photoPosition.current = { x, y };
                setDoctor((current) => current ? { ...current, profilePhotoX: x, profilePhotoY: y } : current);
              }}
              onPointerUp={() => {
                const drag = photoDrag.current; photoDrag.current = null;
                if (!drag || (drag.startX === photoPosition.current.x && drag.startY === photoPosition.current.y)) return;
                setPositionMessage('');
                void updatePresentation({ profilePhotoX: photoPosition.current.x, profilePhotoY: photoPosition.current.y });
              }}
              onPointerCancel={() => { const drag = photoDrag.current; photoDrag.current = null; if (drag) setDoctor((current) => current ? { ...current, profilePhotoX: drag.startX, profilePhotoY: drag.startY } : current); }}
              onKeyDown={(event) => {
                if (presentationBusy || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
                event.preventDefault();
                const x = Math.max(0, Math.min(100, (doctor.profilePhotoX ?? 50) + (event.key === 'ArrowLeft' ? 5 : event.key === 'ArrowRight' ? -5 : 0)));
                const y = Math.max(0, Math.min(100, (doctor.profilePhotoY ?? 50) + (event.key === 'ArrowUp' ? 5 : event.key === 'ArrowDown' ? -5 : 0)));
                void updatePresentation({ profilePhotoX: x, profilePhotoY: y });
              }} /> : <span>{profileInitials(doctor, firstName, lastName)}</span>}
            </div>
            <button type="button" className="doctor-profile-camera" aria-label="Change profile photo" title="Upload profile photo" onClick={() => photoInput.current?.click()} disabled={presentationBusy}>
              <Icon name="camera" />
            </button>
          </div>
          {doctor?.profilePhotoUrl ? <div className="doctor-photo-zoom" aria-label="Photo zoom controls">
            <button type="button" aria-label="Zoom out photo" disabled={presentationBusy || (doctor.profilePhotoZoom ?? 1) <= 1} onClick={() => void updatePresentation({ profilePhotoZoom: Math.max(1, Math.round(((doctor.profilePhotoZoom ?? 1) - .2) * 10) / 10) })}>−</button>
            <span>{Math.round((doctor.profilePhotoZoom ?? 1) * 100)}%</span>
            <button type="button" aria-label="Zoom in photo" disabled={presentationBusy || (doctor.profilePhotoZoom ?? 1) >= 3} onClick={() => void updatePresentation({ profilePhotoZoom: Math.min(3, Math.round(((doctor.profilePhotoZoom ?? 1) + .2) * 10) / 10) })}>+</button>
          </div> : null}
          {doctor?.profilePhotoUrl ? <small className="doctor-photo-drag-hint">Zoom in, then drag to position.</small> : null}
          </div>
          <input ref={photoInput} type="file" accept="image/jpeg,image/png" hidden aria-label="Upload profile photo" onChange={(event) => { void uploadPhoto(event.target.files?.[0]); event.target.value = ''; }} />
          <div className="doctor-profile-identity">
            <h2>{doctor ? profileName(doctor) : [professionalTitle || 'Doctor', firstName, middleName, lastName, suffix].filter(Boolean).join(' ') || 'Doctor account'}</h2>
            <strong>{doctor?.specialization ?? (specialization || 'Specialization')}</strong>
            <p><Icon name="location" /> {activeClinics} active {activeClinics === 1 ? 'clinic' : 'clinics'}</p>
            <p><Icon name="mail" /> {accountContact.email ?? 'Email not entered'}</p>
            <p><Icon name="phone" /> {accountContact.phone ?? 'Contact number not entered'}</p>
          </div>
          <div className="doctor-profile-public-state">
            <span className={`doctor-profile-status-pill ${isPublished ? 'published' : ''}`}><Icon name={isPublished ? 'check' : 'lock'} /> {publicStatusLabel}</span>
            <p>{publicStatusCopy}</p>
            <button type="button" className="doctor-profile-secondary" onClick={previewWebpage} disabled={loadError}><Icon name="eye" /> Preview Webpage</button>
          </div>
        </section>

        <section className="doctor-profile-card">
          <div className="doctor-profile-section-title">
            <span>1.</span>
            <div><h3>Professional Information</h3><p>Information already available from your current profile is filled automatically.</p></div>
          </div>
          <div className="doctor-profile-grid four">
            <label>First Name<input type="text" placeholder="First name" value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={!isOnboarding} /></label>
            <label>Middle Name <span>(Optional)</span><input type="text" placeholder="Middle name" value={middleName} onChange={(event) => setMiddleName(event.target.value)} disabled={!isOnboarding} /></label>
            <label>Last Name<input type="text" placeholder="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={!isOnboarding} /></label>
            <label>Suffix <span>(Optional)</span><select value={suffix} onChange={(event) => setSuffix(event.target.value)} disabled={!isOnboarding}><option value="">Select suffix</option><option>Jr.</option><option>Sr.</option><option>III</option></select></label>
          </div>
          <div className="doctor-profile-grid two">
            <label>Professional Title<input type="text" placeholder="Doctor" value={professionalTitle} onChange={(event) => setProfessionalTitle(event.target.value)} disabled={!isOnboarding} /><small>e.g., Doctor, Medical Specialist</small></label>
            <label>Specialization<input type="text" placeholder="Your area of medical practice" value={specialization} onChange={(event) => setSpecialization(event.target.value)} disabled={!isOnboarding} /><small>Your area of medical practice</small></label>
          </div>
          <div className="doctor-profile-license-row">
            <label>License Number<div className="doctor-profile-inline-field"><input type="text" placeholder="Professional license number" value={licenseNumber} onChange={(event) => setLicenseNumber(event.target.value)} readOnly={!isOnboarding} /><button type="button" title={isOnboarding ? 'Enter your professional license number' : 'License-change workflow is not connected yet'} disabled={isOnboarding}>{isOnboarding ? 'Required' : 'Change License'}</button></div><small>{isOnboarding ? 'Required for initial Doctor onboarding. After onboarding, license changes use a separate protected workflow.' : 'Your current professional license number is protected from ordinary profile editing.'}</small></label>
          </div>
          {isOnboarding ? <div className="doctor-profile-onboarding-actions"><button type="button" className="doctor-profile-primary" onClick={() => void saveInitialProfessionalProfile()} disabled={savingOnboarding}>{savingOnboarding ? 'Saving…' : 'Save Professional Profile'}</button>{saveError ? <p className="doctor-profile-save-error" role="alert">{saveError}</p> : null}</div> : null}
          {saveMessage ? <p className="doctor-profile-save-success" role="status">{saveMessage}</p> : null}
        </section>

        <section className="doctor-profile-card">
          <div className="doctor-profile-section-title">
            <span>2.</span>
            <div><h3>About Me</h3><p>Write a short description about yourself and your approach to patient care.</p></div>
          </div>
          <label className="doctor-profile-full-label">Profile Description
            <textarea maxLength={2000} placeholder="Write a short professional description that patients can read on your public webpage." value={description} onChange={(event) => setDescription(event.target.value)} disabled={!isOnboarding} />
            <span className="doctor-profile-field-footer"><small>{isOnboarding ? 'Optional during onboarding.' : 'Profile editing after onboarding will use the protected edit workflow.'}</small><small>Characters: {description.length}/2000</small></span>
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
              <div className="doctor-profile-url-field"><span>{profileUrl ?? 'Public profile address is not available yet'}</span><button type="button" onClick={() => void copyProfileLink()} disabled={!profileUrl}><Icon name="copy" /> {copied ? 'Copied' : 'Copy Link'}</button></div>
            </div>
            <div>
              <label>Status</label>
              <span className={`doctor-profile-status-pill ${isPublished ? 'published' : ''}`}><Icon name={isPublished ? 'check' : 'lock'} /> {publicStatusLabel}</span>
              <p>{publicStatusCopy}</p>
            </div>
          </div>
          <div className="doctor-profile-actions">
            <button type="button" className="doctor-profile-secondary" onClick={previewWebpage} disabled={loadError}><Icon name="eye" /> Preview Webpage</button>
            <button type="button" className="doctor-profile-primary" title="Publishing is not connected yet">◎ Publish Webpage</button>
            <button type="button" className="doctor-profile-secondary" title="Doctor-profile QR generation is not connected yet"><Icon name="qr" /> Generate QR</button>
            <button type="button" className="doctor-profile-secondary" title="Calling-card printing is not connected yet"><Icon name="print" /> Print Calling Card</button>
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
          <button type="button" className="doctor-profile-secondary" title="Profile guide is not connected yet">View Profile Guide ↗</button>
        </section>
      </aside>
    </div>
  );
}
