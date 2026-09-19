import { useEffect, useRef, useState } from 'react';
import './ServiceManagementEditor.css';
import { apiRequest } from '../api/client';

type ServiceRow = {
  id: string | number;
  effectiveServiceId?: string;
  sourceDoctorServiceTemplateId?: string;
  name: string;
  description: string;
  minutes: number;
  active: boolean;
};

type Props = {
  services: ServiceRow[];
  setServices: (value: ServiceRow[]) => void;
};

const iconProps = {
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="M4 7h16" />
      <path d="m9 7 1-3h4l1 3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  );
}

function DocumentIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}><path d="M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8M8 16h8" /></svg>;
}

export function ServiceManagementEditor({ services, setServices }: Props) {
  const [draft, setDraft] = useState<ServiceRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draggingId, setDraggingId] = useState<string | number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = draft !== null || defaultsOpen;
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement;
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
      opener.current?.focus();
    }
  }, [open]);

  function close() {
    if (busy) return;
    setDraft(null);
    setDefaultsOpen(false);
    setError('');
  }
  function saveService(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.name.trim() || !Number.isInteger(draft.minutes) || draft.minutes < 1 || draft.minutes > 1440) {
      setError('Enter a service name and a duration between 1 and 1,440 minutes.');
      return;
    }
    const saved = { ...draft, name: draft.name.trim() };
    setServices(adding ? [...services, saved] : services.map((row) => row.id === draft.id ? saved : row));
    close();
  }
  async function applyDefaults() {
    setBusy(true);
    setError('');
    try {
      const defaults = await apiRequest<{ services: { id: string; name: string; description?: string | null; durationMinutes: number; status: string }[] }>('/doctor/defaults');
      if (!defaults.services.length) {
        setError('No default services are available. Add services in your doctor profile first.');
        return;
      }
      setServices(defaults.services.map((service) => ({
        id: `new-service-${crypto.randomUUID()}`,
        sourceDoctorServiceTemplateId: service.id,
        name: service.name,
        description: service.description ?? '',
        minutes: service.durationMinutes,
        active: service.status === 'ACTIVE',
      })));
      setDefaultsOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load doctor defaults. Please try again.');
    } finally { setBusy(false); }
  }

  return <>
    <section className="service-management-card" aria-label="Clinic services">
      <div className="clinic-section-toolbar service-management-toolbar">
        <h3>Services ({services.length})</h3>
        <div>
          <button className="clinic-primary" type="button" onClick={() => { setError(''); setDefaultsOpen(true); }}><DocumentIcon />Apply Doctor Defaults</button>
          <button className="clinic-primary" type="button" onClick={() => {
            setAdding(true); setError('');
            setDraft({ id: `new-service-${crypto.randomUUID()}`, name: '', description: '', minutes: 0, active: true });
          }}>+ Add Service</button>
        </div>
      </div>
      <div className="service-management-table">
        <div className="service-management-head" aria-hidden="true"><span>Service</span><span>Duration</span><span>Status</span><span>Actions</span></div>
        {services.map((service) => <div className="service-management-row" key={service.id} draggable title="Drag to reorder service"
          onDragStart={() => setDraggingId(service.id)} onDragOver={(event) => event.preventDefault()}
          onDragEnd={() => setDraggingId(null)} onDrop={(event) => {
            event.preventDefault();
            if (draggingId === null || draggingId === service.id) return;
            const rows = [...services];
            const index = rows.findIndex((row) => row.id === draggingId);
            if (index < 0) return;
            const [moved] = rows.splice(index, 1);
            rows.splice(services.findIndex((row) => row.id === service.id), 0, moved);
            setServices(rows); setDraggingId(null);
          }}>
          <div className="service-management-service"><strong>{service.name}</strong><span>{service.description || 'No description'}</span></div>
          <div className="service-management-duration"><span>{service.minutes} min</span></div>
          <div className="service-management-status"><span className={`clinic-status-pill${service.active ? ' is-active' : ' is-inactive'}`}>{service.active ? 'Active' : 'Inactive'}</span></div>
          <div className="service-management-actions">
            <button className="service-management-icon-action" type="button" title="Edit service" aria-label={`Edit service ${service.name}`} onClick={() => { setAdding(false); setError(''); setDraft({ ...service }); }}><PencilIcon /></button>
            <button className="service-management-icon-action" type="button" title="Delete service" aria-label={`Delete service ${service.name}`} onClick={() => setServices(services.filter((row) => row.id !== service.id))}><TrashIcon /></button>
          </div>
        </div>)}
        {!services.length && <p className="service-management-empty">No services added yet. Add a service or apply your doctor defaults.</p>}
      </div>
      <div className="service-management-note"><span aria-hidden="true">i</span><p>Service duration must be greater than 0 minutes and up to 24 hours (1,440 minutes).</p></div>
    </section>
    <dialog ref={dialogRef} className="service-management-dialog" aria-labelledby="service-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="service-dialog-heading"><h2 id="service-dialog-title">{defaultsOpen ? <><DocumentIcon />Apply Doctor Defaults</> : adding ? 'Add Service' : 'Edit Service'}</h2><button type="button" aria-label="Close service dialog" disabled={busy} onClick={close}>×</button></div>
      {defaultsOpen ? <>
        <p>This will copy your default services from your doctor profile to this clinic.</p>
        <div className="service-management-note service-defaults-note"><span aria-hidden="true">i</span><ul><li>Existing services in this clinic will be replaced.</li><li>Service names, descriptions, durations and status will be copied.</li><li>You can review and edit the services after applying.</li></ul></div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="service-dialog-footer"><button className="clinic-secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button className="clinic-primary" type="button" disabled={busy} onClick={() => void applyDefaults()}>{busy ? 'Applying…' : 'Apply Defaults'}</button></div>
      </> : draft && <form onSubmit={saveService}>
        <div className="service-dialog-fields">
          <label>Service Name <em>*</em><input required autoFocus aria-label={`Service name for ${draft.name}`} placeholder="e.g. Consultation" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Duration (minutes) <em>*</em><div className="service-dialog-duration"><input required aria-label={`Duration for ${draft.name}`} type="number" min={1} max={1440} step={1} value={draft.minutes || ''} placeholder="e.g. 30" onChange={(event) => setDraft({ ...draft, minutes: Number(event.target.value) })} /><span>min</span></div><small>Enter a value between 1 and 1,440.</small></label>
          <label>Description (Optional)<div className="service-dialog-description"><textarea aria-label={`Service description for ${draft.name}`} maxLength={200} placeholder="Brief description of the service..." value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><small>{draft.description.length}/200</small></div></label>
          <label>Status <em>*</em><select aria-label={`Status for ${draft.name}`} value={draft.active ? 'ACTIVE' : 'INACTIVE'} onChange={(event) => setDraft({ ...draft, active: event.target.value === 'ACTIVE' })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
        </div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="service-dialog-footer"><button className="clinic-secondary" type="button" onClick={close}>Cancel</button><button className="clinic-primary" type="submit" aria-label={adding ? 'Add Service' : `Save changes for ${draft.name}`}>{adding ? 'Add Service' : 'Save Changes'}</button></div>
      </form>}
    </dialog>
  </>;
}
