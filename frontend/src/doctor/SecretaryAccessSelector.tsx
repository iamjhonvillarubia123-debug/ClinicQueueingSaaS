export type SecretaryAccessProfile = 'STANDARD' | 'FULL_CLINIC_CONFIGURATION' | 'CUSTOM';

export type SecretaryAccessSelection = {
  accessProfile: SecretaryAccessProfile;
  canManageClinicDetails: boolean;
  canManageServices: boolean;
  canManageBookingQuestions: boolean;
  canManageSchedules: boolean;
  cancelClinicDay: boolean;
  assignDaySecretary: boolean;
};

export const standardSecretaryAccess: SecretaryAccessSelection = {
  accessProfile: 'STANDARD',
  canManageClinicDetails: false,
  canManageServices: false,
  canManageBookingQuestions: false,
  canManageSchedules: false,
  cancelClinicDay: false,
  assignDaySecretary: false,
};

export function SecretaryAccessSelector({ value, onChange }: { value: SecretaryAccessSelection; onChange: (value: SecretaryAccessSelection) => void }) {
  function setProfile(accessProfile: SecretaryAccessProfile) {
    if (accessProfile === 'STANDARD') {
      onChange({ ...value, accessProfile, canManageClinicDetails: false, canManageServices: false, canManageBookingQuestions: false, canManageSchedules: false });
      return;
    }
    if (accessProfile === 'FULL_CLINIC_CONFIGURATION') {
      onChange({ ...value, accessProfile, canManageClinicDetails: true, canManageServices: true, canManageBookingQuestions: true, canManageSchedules: true });
      return;
    }
    onChange({ ...value, accessProfile });
  }

  const custom = value.accessProfile === 'CUSTOM';
  return (
    <section className="secretary-access-selector" aria-labelledby="secretary-access-heading">
      <div className="practice-panel-heading">
        <p className="eyebrow">Clinic access</p>
        <h3 id="secretary-access-heading">Choose Secretary access</h3>
        <p>Standard covers queue and ordinary clinic-day operations. Configuration access lets the Secretary prepare changes, but those changes still require Doctor approval.</p>
      </div>
      <div className="access-profile-options">
        <label><input type="radio" name="secretary-access-profile" checked={value.accessProfile === 'STANDARD'} onChange={() => setProfile('STANDARD')} /><span><strong>Standard</strong><small>Queue and ordinary Secretary operations only.</small></span></label>
        <label><input type="radio" name="secretary-access-profile" checked={value.accessProfile === 'FULL_CLINIC_CONFIGURATION'} onChange={() => setProfile('FULL_CLINIC_CONFIGURATION')} /><span><strong>Full clinic configuration</strong><small>May propose clinic details, services, booking questions, and schedules.</small></span></label>
        <label><input type="radio" name="secretary-access-profile" checked={value.accessProfile === 'CUSTOM'} onChange={() => setProfile('CUSTOM')} /><span><strong>Custom</strong><small>Doctor chooses specific configuration areas and exceptional capabilities.</small></span></label>
      </div>

      {custom ? <div className="access-custom-grid">
        <label><input type="checkbox" checked={value.canManageClinicDetails} onChange={(e) => onChange({ ...value, canManageClinicDetails: e.target.checked })} /> Clinic details</label>
        <label><input type="checkbox" checked={value.canManageServices} onChange={(e) => onChange({ ...value, canManageServices: e.target.checked })} /> Services</label>
        <label><input type="checkbox" checked={value.canManageBookingQuestions} onChange={(e) => onChange({ ...value, canManageBookingQuestions: e.target.checked })} /> Booking questions</label>
        <label><input type="checkbox" checked={value.canManageSchedules} onChange={(e) => onChange({ ...value, canManageSchedules: e.target.checked })} /> Clinic schedules</label>
      </div> : null}

      <div className="access-exception-list">
        <p><strong>Exceptional authority</strong></p>
        <label><input type="checkbox" checked={value.assignDaySecretary} onChange={(e) => onChange({ ...value, assignDaySecretary: e.target.checked })} /> Allow assignment of a day Secretary for a specific service date</label>
        <label><input type="checkbox" checked={value.cancelClinicDay} onChange={(e) => onChange({ ...value, cancelClinicDay: e.target.checked })} /> Allow whole clinic-day cancellation, subject to password re-authentication and cancellation controls</label>
      </div>
    </section>
  );
}
