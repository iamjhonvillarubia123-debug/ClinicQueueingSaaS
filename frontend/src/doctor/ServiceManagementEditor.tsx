import { useEffect, useRef, useState } from 'react';
import './ServiceManagementEditor.css';

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

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...iconProps}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function ServiceManagementEditor({ services, setServices }: Props) {
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<ServiceRow | null>(null);
  const [draggingId, setDraggingId] = useState<string | number | null>(null);
  const [dragOverId, setDragOverId] = useState<string | number | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId !== null) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingId]);

  function addService() {
    const id = `new-service-${Date.now()}`;
    const service: ServiceRow = {
      id,
      name: 'New Service',
      description: 'Clinic-specific service',
      minutes: 30,
      active: true,
    };
    setServices([...services, service]);
    setEditSnapshot({ ...service });
    setEditingId(id);
  }

  function updateService(id: string | number, patch: Partial<ServiceRow>) {
    setServices(
      services.map((service) =>
        service.id === id ? { ...service, ...patch } : service,
      ),
    );
  }

  function startEditing(service: ServiceRow) {
    setEditSnapshot({ ...service });
    setEditingId(service.id);
  }

  function finishEditing() {
    setEditSnapshot(null);
    setEditingId(null);
  }

  function cancelEditing() {
    if (editSnapshot) {
      setServices(
        services.map((service) =>
          service.id === editSnapshot.id ? { ...editSnapshot } : service,
        ),
      );
    }
    finishEditing();
  }

  function deleteService(id: string | number) {
    setServices(services.filter((service) => service.id !== id));
    if (editingId === id) finishEditing();
  }

  function reorderServices(sourceId: string | number, targetId: string | number) {
    if (sourceId === targetId) return;
    const sourceIndex = services.findIndex((service) => service.id === sourceId);
    const targetIndex = services.findIndex((service) => service.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const reordered = [...services];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setServices(reordered);
  }

  function finishDragging() {
    setDraggingId(null);
    setDragOverId(null);
  }

  return (
    <>
      <div className="clinic-section-toolbar">
        <p>Add or manage the services offered in this clinic.</p>
        <div>
          <button className="clinic-secondary" type="button">
            Apply Doctor Defaults
          </button>
          <button className="clinic-primary" type="button" onClick={addService}>
            + Add Service
          </button>
        </div>
      </div>

      <div className="service-management-table">
        <div className="service-management-head" aria-hidden="true">
          <span>Service</span>
          <span>Duration</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {services.map((service) => {
          const editing = editingId === service.id;
          const dragging = draggingId === service.id;
          const dragOver = dragOverId === service.id && !dragging;
          return (
            <div
              className={`service-management-row${editing ? ' is-editing' : ''}${dragging ? ' is-dragging' : ''}${dragOver ? ' is-drag-over' : ''}`}
              key={service.id}
              draggable={!editing}
              title={editing ? undefined : 'Drag to reorder service'}
              onDragStart={(event) => {
                if (editing) {
                  event.preventDefault();
                  return;
                }
                setDraggingId(service.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(service.id));
              }}
              onDragOver={(event) => {
                if (editing || draggingId === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverId(service.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingId !== null && !editing) {
                  reorderServices(draggingId, service.id);
                }
                finishDragging();
              }}
              onDragEnd={finishDragging}
            >
              <div className="service-management-service">
                {editing ? (
                  <>
                    <label>
                      <span>Service Name</span>
                      <input
                        ref={nameInputRef}
                        aria-label={`Service name for ${service.name}`}
                        value={service.name}
                        onChange={(event) =>
                          updateService(service.id, { name: event.target.value })
                        }
                        placeholder="Service name"
                      />
                    </label>
                    <label>
                      <span>Description</span>
                      <input
                        aria-label={`Service description for ${service.name}`}
                        value={service.description}
                        onChange={(event) =>
                          updateService(service.id, {
                            description: event.target.value,
                          })
                        }
                        placeholder="Short service description"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <strong>{service.name}</strong>
                    <span>{service.description || 'No description'}</span>
                  </>
                )}
              </div>

              <div className="service-management-duration">
                {editing ? (
                  <label>
                    <span>Duration (min)</span>
                    <div>
                      <input
                        aria-label={`Duration for ${service.name}`}
                        type="number"
                        min={1}
                        max={1440}
                        value={service.minutes}
                        onChange={(event) =>
                          updateService(service.id, {
                            minutes: Number(event.target.value),
                          })
                        }
                      />
                      <span>min</span>
                    </div>
                  </label>
                ) : (
                  <span>{service.minutes} min</span>
                )}
              </div>

              <div className="service-management-status">
                {editing ? (
                  <label>
                    <span>Status</span>
                    <select
                      aria-label={`Status for ${service.name}`}
                      value={service.active ? 'ACTIVE' : 'INACTIVE'}
                      onChange={(event) =>
                        updateService(service.id, {
                          active: event.target.value === 'ACTIVE',
                        })
                      }
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </label>
                ) : (
                  <span
                    className={`clinic-status-pill${service.active ? ' is-active' : ''}`}
                  >
                    {service.active ? 'Active' : 'Inactive'}
                  </span>
                )}
              </div>

              <div className="service-management-actions">
                {editing ? (
                  <>
                    <button
                      className="service-management-confirm"
                      type="button"
                      title="Save service changes"
                      aria-label={`Save changes for ${service.name}`}
                      onClick={finishEditing}
                      onDragStart={(event) => event.preventDefault()}
                    >
                      <CheckIcon />
                      <span>Save</span>
                    </button>
                    <button
                      className="service-management-cancel"
                      type="button"
                      title="Cancel service editing"
                      aria-label={`Cancel editing ${service.name}`}
                      onClick={cancelEditing}
                      onDragStart={(event) => event.preventDefault()}
                    >
                      <CloseIcon />
                      <span>Cancel</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="service-management-icon-action"
                      type="button"
                      title="Edit service"
                      aria-label={`Edit service ${service.name}`}
                      onClick={() => startEditing(service)}
                      onDragStart={(event) => event.preventDefault()}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      className="service-management-icon-action"
                      type="button"
                      title="Delete service"
                      aria-label={`Delete service ${service.name}`}
                      onClick={() => deleteService(service.id)}
                      onDragStart={(event) => event.preventDefault()}
                    >
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="clinic-info-strip">
        ⓘ Service duration must be greater than 0 minutes and up to 24 hours
        (1,440 minutes).
      </div>
    </>
  );
}
