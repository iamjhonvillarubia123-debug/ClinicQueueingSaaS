import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';

type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

type ScheduleRow = {
  weekday: Weekday;
  isOpen: boolean;
  opensAtLocal: string;
  closesAtLocal: string;
  maximumOperatingUntilLocal: string;
};

type LocationConfiguration = {
  id: string;
  lifecycleStatus: string;
  name: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  cityMunicipality: string | null;
  province: string | null;
  postalCode: string | null;
  contactNumber: string | null;
  countryCode: string | null;
  timeZone: string | null;
  schedules: Array<{
    weekday: Weekday;
    isOpen: boolean;
    opensAtLocal: string | null;
    closesAtLocal: string | null;
    maximumOperatingUntilLocal: string | null;
  }>;
};

type LocationFields = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  cityMunicipality: string;
  province: string;
  postalCode: string;
  contactNumber: string;
  countryCode: string;
  timeZone: string;
};

const weekdays: Weekday[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function blankSchedule(weekday: Weekday): ScheduleRow {
  return { weekday, isOpen: false, opensAtLocal: '', closesAtLocal: '', maximumOperatingUntilLocal: '' };
}

function displayDay(weekday: Weekday) {
  return weekday.charAt(0) + weekday.slice(1).toLowerCase();
}

function apiTime(value: string | null) {
  if (!value) return '';
  const match = /T(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value.slice(0, 5);
}

function canonicalTimeZone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    return trimmed;
  }
}

function initialTimeZone(countryCode: string | null, configuredTimeZone: string | null) {
  if (configuredTimeZone?.trim()) return canonicalTimeZone(configuredTimeZone);
  return countryCode?.trim().toUpperCase() === 'PH' ? 'Asia/Manila' : '';
}

function fieldsFromConfiguration(configuration: LocationConfiguration): LocationFields {
  return {
    name: configuration.name ?? '',
    addressLine1: configuration.addressLine1 ?? '',
    addressLine2: configuration.addressLine2 ?? '',
    cityMunicipality: configuration.cityMunicipality ?? '',
    province: configuration.province ?? '',
    postalCode: configuration.postalCode ?? '',
    contactNumber: configuration.contactNumber ?? '',
    countryCode: configuration.countryCode ?? '',
    timeZone: initialTimeZone(configuration.countryCode, configuration.timeZone),
  };
}

function schedulesFromConfiguration(configuration: LocationConfiguration): ScheduleRow[] {
  const byDay = new Map(configuration.schedules.map((row) => [row.weekday, row]));
  return weekdays.map((weekday) => {
    const row = byDay.get(weekday);
    return row ? {
      weekday,
      isOpen: row.isOpen,
      opensAtLocal: apiTime(row.opensAtLocal),
      closesAtLocal: apiTime(row.closesAtLocal),
      maximumOperatingUntilLocal: apiTime(row.maximumOperatingUntilLocal),
    } : blankSchedule(weekday);
  });
}

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Unable to save the clinic configuration. Please try again.';
}

export function PracticeLocationConfigurationPage() {
  const { practiceLocationId } = useParams();
  const [location, setLocation] = useState<LocationConfiguration | null>(null);
  const [fields, setFields] = useState<LocationFields>({ name: '', addressLine1: '', addressLine2: '', cityMunicipality: '', province: '', postalCode: '', contactNumber: '', countryCode: '', timeZone: '' });
  const [schedules, setSchedules] = useState<ScheduleRow[]>(weekdays.map(blankSchedule));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!practiceLocationId) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest<LocationConfiguration>(`/practice-location/${encodeURIComponent(practiceLocationId)}/configuration`);
      setLocation(response);
      setFields(fieldsFromConfiguration(response));
      setSchedules(schedulesFromConfiguration(response));
      setDirty(false);
      setSaved(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [practiceLocationId]);

  function markChanged() {
    setDirty(true);
    setSaved(false);
    setError('');
  }

  function updateField(field: keyof LocationFields, value: string) {
    markChanged();
    setFields((current) => {
      if (field === 'countryCode') {
        const countryCode = value.toUpperCase();
        return {
          ...current,
          countryCode,
          timeZone: !current.timeZone.trim() && countryCode === 'PH' ? 'Asia/Manila' : current.timeZone,
        };
      }
      return { ...current, [field]: value };
    });
  }

  function updateSchedule(weekday: Weekday, patch: Partial<ScheduleRow>) {
    markChanged();
    setSchedules((current) => current.map((row) => {
      if (row.weekday !== weekday) return row;
      const next = { ...row, ...patch };
      return next.isOpen ? next : { ...next, opensAtLocal: '', closesAtLocal: '', maximumOperatingUntilLocal: '' };
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!practiceLocationId || location?.lifecycleStatus !== 'DRAFT' || !dirty) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const normalizedFields = { ...fields, timeZone: canonicalTimeZone(fields.timeZone) };
      const response = await apiRequest<LocationConfiguration>(`/practice-location/${encodeURIComponent(practiceLocationId)}/draft-configuration`, {
        method: 'POST',
        body: {
          ...normalizedFields,
          schedules: schedules.map((row) => ({
            weekday: row.weekday,
            isOpen: row.isOpen,
            opensAtLocal: row.isOpen ? row.opensAtLocal || null : null,
            closesAtLocal: row.isOpen ? row.closesAtLocal || null : null,
            maximumOperatingUntilLocal: row.isOpen ? row.maximumOperatingUntilLocal || null : null,
          })),
        },
      });
      setLocation(response);
      setFields(fieldsFromConfiguration(response));
      setSchedules(schedulesFromConfiguration(response));
      setDirty(false);
      setSaved(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="practice-admin-page"><p className="practice-muted">Loading clinic configuration…</p></section>;
  if (!location) return <section className="practice-admin-page"><div className="form-error" role="alert">{error || 'Clinic location was not found.'}</div><Link to="/app/practice-locations">Clinic locations</Link></section>;

  const editable = location.lifecycleStatus === 'DRAFT';
  const timeZoneOptions = fields.timeZone && fields.timeZone !== 'Asia/Manila' ? [fields.timeZone, 'Asia/Manila'] : ['Asia/Manila'];
  const saveStatus = saving ? 'Saving changes…' : saved ? 'Changes saved' : dirty ? 'Unsaved changes' : 'Changes remain private while this clinic location is a draft.';

  return (
    <section className="practice-admin-page" aria-labelledby="location-config-heading">
      <div className="practice-admin-heading">
        <div>
          <p className="eyebrow">Clinic configuration</p>
          <h1 id="location-config-heading">{fields.name.trim() || 'Untitled clinic location'}</h1>
          <p>Configure the clinic details and regular weekly hours while this clinic location is still a draft.</p>
        </div>
        <Link className="secondary-action" to="/app/practice-locations">← Back to clinic locations</Link>
      </div>

      <div className="practice-location-title-row"><span className="practice-status">{location.lifecycleStatus.replaceAll('_', ' ')}</span></div>
      {!editable ? <div className="practice-notice">Active clinic schedule changes require the controlled appointment-reconciliation workflow and are not edited from this draft screen.</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {saved ? <div className="practice-notice practice-success" role="status">Clinic settings saved.</div> : null}

      <form className="practice-form clinic-config-form" onSubmit={save}>
        <section className="practice-create-panel">
          <div className="practice-panel-heading">
            <p className="eyebrow">Clinic details</p>
            <h2>Location information</h2>
            <p>Draft clinic locations may remain partial. Country and time zone become operationally important before activation.</p>
          </div>

          <div className="clinic-details-grid">
            <label className="clinic-field-wide">Clinic location name<input disabled={!editable} maxLength={200} value={fields.name} onChange={(event) => updateField('name', event.target.value)} /></label>
            <label className="clinic-field-wide">Address line 1<input disabled={!editable} maxLength={255} value={fields.addressLine1} onChange={(event) => updateField('addressLine1', event.target.value)} /></label>
            <label className="clinic-field-wide">Address line 2<input disabled={!editable} maxLength={255} value={fields.addressLine2} onChange={(event) => updateField('addressLine2', event.target.value)} /></label>
            <label>City / municipality<input disabled={!editable} maxLength={120} value={fields.cityMunicipality} onChange={(event) => updateField('cityMunicipality', event.target.value)} /></label>
            <label>Province<input disabled={!editable} maxLength={120} value={fields.province} onChange={(event) => updateField('province', event.target.value)} /></label>
            <label>Postal code<input disabled={!editable} maxLength={20} value={fields.postalCode} onChange={(event) => updateField('postalCode', event.target.value)} /></label>
            <label>Contact number<input disabled={!editable} maxLength={30} value={fields.contactNumber} onChange={(event) => updateField('contactNumber', event.target.value)} /></label>
            <label>Country code<input disabled={!editable} maxLength={2} placeholder="PH" value={fields.countryCode} onChange={(event) => updateField('countryCode', event.target.value)} /></label>
            <label>Time zone<select disabled={!editable} value={fields.timeZone} onChange={(event) => updateField('timeZone', event.target.value)}><option value="">Select time zone</option>{timeZoneOptions.map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone}</option>)}</select><span className="optional-label">Philippines is available now. Additional time zones will be added later.</span></label>
          </div>
        </section>

        <section className="practice-create-panel schedule-panel">
          <div className="practice-panel-heading">
            <p className="eyebrow">Recurring schedule</p>
            <h2>Regular clinic hours</h2>
            <p>Turn on the days this clinic normally operates, then set one opening and closing interval for each open day.</p>
          </div>

          <div className="weekly-schedule-list">
            <div className="weekly-schedule-header" aria-hidden="true">
              <span>Day</span>
              <span>Opens</span>
              <span>Closes</span>
              <span>Maximum operating until <small>optional</small></span>
            </div>
            {schedules.map((row) => (
              <div className={`weekly-schedule-row${row.isOpen ? ' is-open' : ''}`} key={row.weekday}>
                <label className="weekly-day-toggle">
                  <input disabled={!editable} type="checkbox" checked={row.isOpen} onChange={(event) => updateSchedule(row.weekday, { isOpen: event.target.checked })} />
                  <strong>{displayDay(row.weekday)}</strong>
                </label>
                {row.isOpen ? (
                  <>
                    <label className="schedule-time-control"><span className="sr-only">{displayDay(row.weekday)} opening time</span><input aria-label={`${displayDay(row.weekday)} opening time`} disabled={!editable} required type="time" value={row.opensAtLocal} onChange={(event) => updateSchedule(row.weekday, { opensAtLocal: event.target.value })} /></label>
                    <label className="schedule-time-control"><span className="sr-only">{displayDay(row.weekday)} closing time</span><input aria-label={`${displayDay(row.weekday)} closing time`} disabled={!editable} required type="time" value={row.closesAtLocal} onChange={(event) => updateSchedule(row.weekday, { closesAtLocal: event.target.value })} /></label>
                    <label className="schedule-time-control"><span className="sr-only">{displayDay(row.weekday)} maximum operating until</span><input aria-label={`${displayDay(row.weekday)} maximum operating until`} disabled={!editable} type="time" value={row.maximumOperatingUntilLocal} onChange={(event) => updateSchedule(row.weekday, { maximumOperatingUntilLocal: event.target.value })} /></label>
                  </>
                ) : <span className="weekly-closed-state">Closed</span>}
              </div>
            ))}
          </div>

          <p className="practice-muted schedule-note"><strong>Maximum operating until</strong> is an independent workload/capacity ceiling. It does not change the regular clinic closing time.</p>
        </section>

        {editable ? (
          <div className="clinic-save-row">
            <span className={`clinic-save-status${saved ? ' is-saved' : dirty ? ' is-dirty' : ''}`} role="status" aria-live="polite">{saveStatus}</span>
            <button className="primary" type="submit" disabled={saving || !dirty}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save clinic settings'}</button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
