import { useState } from 'react';
import { CopyDefaults } from './CopyDefaults';
import { apiRequest } from '../../api/client';
import {
  Card,
  dateTime,
  Checklist,
  Drawer,
  Help,
  LoadState,
  Note,
  Unconnected,
  useSettingsData,
} from './SettingsShared';

type Service = {
  id: string;
  updatedAt?: string;
  name: string;
  durationMinutes: number;
  status: 'ACTIVE' | 'INACTIVE';
};
type Question = {
  id: string;
  updatedAt?: string;
  questionText: string;
  helpText?: string | null;
  type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  textMaximumLength?: number | null;
  numberMinimum?: number | string | null;
  numberMaximum?: number | string | null;
  selectOptions?: { value: string; label: string }[] | null;
};
type Defaults = { services: Service[]; bookingQuestions: Question[] };
const about = [
  'These templates help you set up new clinics faster.',
  'Clinic-specific settings take precedence.',
  'Changes to templates do not change existing clinics automatically.',
  'Only the Doctor can manage Doctor-wide defaults.',
];

function lastUpdated(items: { updatedAt?: string }[] | undefined) {
  const timestamps = (items ?? [])
    .flatMap((item) => (item.updatedAt ? [Date.parse(item.updatedAt)] : []))
    .filter(Number.isFinite);
  return timestamps.length
    ? dateTime(new Date(Math.max(...timestamps)).toISOString())
    : 'Not available';
}

export function DefaultSettings() {
  const defaults = useSettingsData<Defaults>('/doctor/defaults');
  const settings = useSettingsData<{
    defaultTimeZone: string;
    maximumAdvanceBookingDays: number;
    allowOnlineBooking: boolean;
  }>('/doctor/account/settings');
  const [panel, setPanel] = useState('');
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [previewValue, setPreviewValue] = useState('');
  const [previewEnabled, setPreviewEnabled] = useState(false);
  function open(value: string) {
    setPanel(value);
    setError('');
    setMessage('');
    setEditingService(null);
    setEditingQuestion(null);
    setPreviewValue(
      value.includes('Timezone')
        ? (settings.data?.defaultTimeZone ?? '')
        : String(settings.data?.maximumAdvanceBookingDays ?? ''),
    );
    setPreviewEnabled(settings.data?.allowOnlineBooking ?? false);
  }
  function close() {
    if (!busy) open('');
  }
  async function saveGeneral() {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/doctor/account/settings', {
        method: 'PATCH',
        body: panel.includes('Timezone')
          ? { defaultTimeZone: previewValue }
          : panel.includes('Advance')
            ? { maximumAdvanceBookingDays: Number(previewValue) }
            : { allowOnlineBooking: previewEnabled },
      });
      settings.reload();
      setMessage(
        'Default saved. Existing bookings and clinic configuration were not changed.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to save default.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveTemplate(
    kind: 'services' | 'booking-questions',
    id: string,
    body: unknown,
  ) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await apiRequest(`/doctor/defaults/${kind}${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        body,
      });
      defaults.reload();
      setEditingService(null);
      setEditingQuestion(null);
      setMessage('Template saved. Existing clinics were not changed.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to save template.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="ds-main">
        <p>
          Configure your practice-wide defaults and reusable clinic templates.
        </p>
        <Card
          title="1. General Defaults"
          description="System defaults that control general behavior across your practice."
          icon="globe"
        >
          <LoadState
            error={settings.error}
            loading={!settings.data}
            retry={settings.reload}
          />
          <div className="ds-three">
            {[
              'Default Timezone',
              'Maximum Advance Booking',
              'Public Online Booking',
            ].map((title) => (
              <section className="ds-tile" key={title}>
                <h3>{title}</h3>
                <strong className="ds-value">
                  {!settings.data
                    ? 'Not available'
                    : title === 'Default Timezone'
                      ? settings.data.defaultTimeZone
                      : title === 'Maximum Advance Booking'
                        ? `${settings.data.maximumAdvanceBookingDays} days`
                        : settings.data.allowOnlineBooking
                          ? 'Enabled'
                          : 'Disabled'}
                </strong>
                <p>
                  {title === 'Default Timezone'
                    ? 'Default time zone and Doctor calendar time zone.'
                    : title === 'Maximum Advance Booking'
                      ? 'How far in advance patients can book online.'
                      : 'Practice-wide permission for new online bookings.'}
                </p>
                <button
                  disabled={!settings.data || !!settings.error}
                  onClick={() => open(`Edit ${title}`)}
                >
                  Edit
                </button>
              </section>
            ))}
          </div>
        </Card>
        <Card
          title="2. Clinic Configuration Defaults"
          description="Reusable templates for new clinics. Editing templates does not overwrite existing clinic settings."
          icon="clinic"
        >
          <LoadState
            error={defaults.error}
            loading={!defaults.data}
            retry={defaults.reload}
          />
          {[
            ['Services', defaults.data?.services.length],
            ['Booking Questions', defaults.data?.bookingQuestions.length],
          ].map(([kind, count]) => (
            <div className="ds-row" key={kind}>
              <div>
                <h3>Default {kind}</h3>
                <p>
                  {count === undefined ? 'Not loaded' : `${count} templates`}
                </p>
                <small>
                  Last updated:{' '}
                  {lastUpdated(
                    kind === 'Services'
                      ? defaults.data?.services
                      : defaults.data?.bookingQuestions,
                  )}
                </small>
              </div>
              <div className="ds-actions">
                <button
                  disabled={!defaults.data}
                  onClick={() => open(`Manage Default ${kind}`)}
                >
                  Manage {kind}
                </button>
                <button
                  className="ds-primary"
                  onClick={() => open(`Apply Default ${kind} to Clinics`)}
                >
                  Apply to Clinics
                </button>
              </div>
            </div>
          ))}
          <Note>
            Copying defaults adds missing items without overwriting existing
            clinic settings.
          </Note>
          <button
            disabled={!defaults.data}
            onClick={() => open('Apply All Defaults to Clinics')}
          >
            Apply Services and Questions
          </button>
        </Card>
      </div>
      <aside className="ds-aside">
        <Card title="About Doctor Defaults">
          <Checklist items={about} />
        </Card>
        <Card title="Quick Actions" icon="play">
          {['Export My Data', 'Backup Settings', 'Activity Sessions'].map(
            (action) => (
              <button
                className="ds-quick"
                key={action}
                onClick={() => open(action)}
              >
                {action}
                <span>›</span>
              </button>
            ),
          )}
        </Card>
        <Help title="Defaults Guide" items={about} />
      </aside>
      {panel && (
        <Drawer title={panel} onClose={close} busy={busy}>
          {panel.startsWith('Edit ') && (
            <>
              <Note>
                Timezone does not change existing clinic timezones. Advance
                booking and online booking govern new public bookings across
                your clinics. Existing bookings are preserved; clinic
                availability rules still apply.
              </Note>
              {panel.includes('Timezone') ? (
                <label>
                  Select Timezone
                  <select
                    value={previewValue}
                    onChange={(event) => setPreviewValue(event.target.value)}
                  >
                    <option value="">Choose a timezone</option>
                    {Intl.supportedValuesOf('timeZone').map((zone) => (
                      <option key={zone}>{zone}</option>
                    ))}
                  </select>
                </label>
              ) : panel.includes('Advance') ? (
                <label>
                  Maximum advance booking (days)
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={previewValue}
                    onChange={(event) => setPreviewValue(event.target.value)}
                  />
                </label>
              ) : (
                <label className="ds-checkbox">
                  <input
                    type="checkbox"
                    checked={previewEnabled}
                    onChange={(event) =>
                      setPreviewEnabled(event.target.checked)
                    }
                  />
                  Enable public online booking
                </label>
              )}
              <button
                className="ds-primary"
                disabled={
                  busy ||
                  (panel.includes('Timezone') && !previewValue) ||
                  (panel.includes('Advance') &&
                    (!Number.isInteger(Number(previewValue)) ||
                      Number(previewValue) < 1 ||
                      Number(previewValue) > 365))
                }
                onClick={() => void saveGeneral()}
              >
                Save Changes
              </button>
            </>
          )}
          {panel.startsWith('Apply ') && defaults.data && (
            <CopyDefaults
              key={panel}
              defaults={defaults.data}
              busy={busy}
              setBusy={setBusy}
              kind={
                panel.includes('All Defaults')
                  ? 'both'
                  : panel.includes('Services')
                    ? 'services'
                    : 'questions'
              }
            />
          )}
          {panel === 'Manage Default Services' && (
            <>
              <p>Services suggested when setting up a new clinic.</p>
              <button
                disabled={busy}
                onClick={() => {
                  setEditingService({
                    id: '',
                    name: '',
                    durationMinutes: 15,
                    status: 'ACTIVE',
                  });
                  setError('');
                }}
              >
                + Add Service
              </button>
              {defaults.data?.services.map((service) => (
                <div className="ds-row" key={service.id}>
                  <div>
                    <strong>{service.name}</strong>
                    <small>
                      {service.durationMinutes} mins ·{' '}
                      {service.status === 'ACTIVE'
                        ? 'Available'
                        : 'Unavailable'}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditingService({ ...service });
                      setError('');
                    }}
                  >
                    Edit
                  </button>
                </div>
              ))}
              {defaults.data?.services.length === 0 && (
                <p>No default services yet.</p>
              )}
              {editingService && (
                <form
                  className="ds-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveTemplate('services', editingService.id, {
                      name: editingService.name,
                      durationMinutes: editingService.durationMinutes,
                      status: editingService.status,
                    });
                  }}
                >
                  <h3>{editingService.id ? 'Edit Service' : 'Add Service'}</h3>
                  <label>
                    Service name
                    <input
                      required
                      maxLength={150}
                      value={editingService.name}
                      onChange={(event) =>
                        setEditingService({
                          ...editingService,
                          name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      type="number"
                      required
                      min={1}
                      max={1440}
                      value={editingService.durationMinutes}
                      onChange={(event) =>
                        setEditingService({
                          ...editingService,
                          durationMinutes: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Status
                    <select
                      value={editingService.status}
                      onChange={(event) =>
                        setEditingService({
                          ...editingService,
                          status: event.target.value as Service['status'],
                        })
                      }
                    >
                      <option>ACTIVE</option>
                      <option>INACTIVE</option>
                    </select>
                  </label>
                  <button className="ds-primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save Service'}
                  </button>{' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditingService(null)}
                  >
                    Cancel edit
                  </button>
                </form>
              )}
            </>
          )}
          {panel === 'Manage Default Booking Questions' && (
            <>
              <p>
                Questions suggested when setting up booking for a new clinic.
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  setEditingQuestion({
                    id: '',
                    questionText: '',
                    type: 'TEXT',
                    isRequired: false,
                    isActive: true,
                    displayOrder:
                      Math.max(
                        -1,
                        ...(defaults.data?.bookingQuestions ?? []).map(
                          (item) => item.displayOrder,
                        ),
                      ) + 1,
                  });
                  setError('');
                }}
              >
                + Add Question
              </button>
              {defaults.data?.bookingQuestions.map((question) => (
                <div className="ds-row" key={question.id}>
                  <div>
                    <strong>{question.questionText}</strong>
                    <small>
                      {question.isRequired ? 'Required' : 'Optional'} ·{' '}
                      {question.isActive ? 'Active' : 'Inactive'}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditingQuestion({ ...question });
                      setError('');
                    }}
                  >
                    Edit
                  </button>
                </div>
              ))}
              {defaults.data?.bookingQuestions.length === 0 && (
                <p>No default booking questions yet.</p>
              )}
              {editingQuestion && (
                <form
                  className="ds-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const question = editingQuestion;
                    void saveTemplate('booking-questions', question.id, {
                      questionText: question.questionText,
                      helpText: question.helpText || undefined,
                      type: question.type,
                      isRequired: question.isRequired,
                      displayOrder: question.displayOrder,
                      isActive: question.isActive,
                      textMaximumLength:
                        question.type === 'TEXT'
                          ? (question.textMaximumLength ?? undefined)
                          : undefined,
                      numberMinimum:
                        question.type === 'NUMBER'
                          ? question.numberMinimum == null
                            ? undefined
                            : Number(question.numberMinimum)
                          : undefined,
                      numberMaximum:
                        question.type === 'NUMBER'
                          ? question.numberMaximum == null
                            ? undefined
                            : Number(question.numberMaximum)
                          : undefined,
                      selectOptions:
                        question.type === 'SINGLE_SELECT'
                          ? (question.selectOptions ?? [])
                          : undefined,
                    });
                  }}
                >
                  <h3>
                    {editingQuestion.id ? 'Edit Question' : 'Add Question'}
                  </h3>
                  <label>
                    Question
                    <input
                      required
                      maxLength={500}
                      value={editingQuestion.questionText}
                      onChange={(event) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          questionText: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Help text
                    <input
                      maxLength={500}
                      value={editingQuestion.helpText ?? ''}
                      onChange={(event) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          helpText: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Answer type
                    <select
                      value={editingQuestion.type}
                      onChange={(event) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          type: event.target.value as Question['type'],
                        })
                      }
                    >
                      {['TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_SELECT'].map(
                        (type) => (
                          <option key={type}>{type}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Display order
                    <input
                      type="number"
                      min={0}
                      required
                      value={editingQuestion.displayOrder}
                      onChange={(event) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          displayOrder: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  {editingQuestion.type === 'TEXT' && (
                    <label>
                      Maximum text length (optional)
                      <input
                        type="number"
                        min={1}
                        value={editingQuestion.textMaximumLength ?? ''}
                        onChange={(event) =>
                          setEditingQuestion({
                            ...editingQuestion,
                            textMaximumLength: event.target.value
                              ? Number(event.target.value)
                              : null,
                          })
                        }
                      />
                    </label>
                  )}
                  {editingQuestion.type === 'NUMBER' && (
                    <>
                      {(['numberMinimum', 'numberMaximum'] as const).map(
                        (field) => (
                          <label key={field}>
                            {field === 'numberMinimum' ? 'Minimum' : 'Maximum'}{' '}
                            (optional)
                            <input
                              type="number"
                              step="any"
                              value={editingQuestion[field] ?? ''}
                              onChange={(event) =>
                                setEditingQuestion({
                                  ...editingQuestion,
                                  [field]: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                            />
                          </label>
                        ),
                      )}
                    </>
                  )}
                  {editingQuestion.type === 'SINGLE_SELECT' && (
                    <>
                      <h3>Answer options</h3>
                      {(editingQuestion.selectOptions ?? []).map(
                        (option, index) => (
                          <div className="ds-option" key={index}>
                            <label>
                              Option {index + 1} value
                              <input
                                required
                                maxLength={100}
                                value={option.value}
                                onChange={(event) =>
                                  setEditingQuestion({
                                    ...editingQuestion,
                                    selectOptions:
                                      editingQuestion.selectOptions!.map(
                                        (item, i) =>
                                          i === index
                                            ? {
                                                ...item,
                                                value: event.target.value,
                                              }
                                            : item,
                                      ),
                                  })
                                }
                              />
                            </label>
                            <label>
                              Option {index + 1} label
                              <input
                                required
                                maxLength={200}
                                value={option.label}
                                onChange={(event) =>
                                  setEditingQuestion({
                                    ...editingQuestion,
                                    selectOptions:
                                      editingQuestion.selectOptions!.map(
                                        (item, i) =>
                                          i === index
                                            ? {
                                                ...item,
                                                label: event.target.value,
                                              }
                                            : item,
                                      ),
                                  })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingQuestion({
                                  ...editingQuestion,
                                  selectOptions:
                                    editingQuestion.selectOptions!.filter(
                                      (_, i) => i !== index,
                                    ),
                                })
                              }
                            >
                              Remove option
                            </button>
                          </div>
                        ),
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setEditingQuestion({
                            ...editingQuestion,
                            selectOptions: [
                              ...(editingQuestion.selectOptions ?? []),
                              { value: '', label: '' },
                            ],
                          })
                        }
                      >
                        Add option
                      </button>
                    </>
                  )}
                  {(['isRequired', 'isActive'] as const).map((field) => (
                    <label className="ds-checkbox" key={field}>
                      <input
                        type="checkbox"
                        checked={editingQuestion[field]}
                        onChange={(event) =>
                          setEditingQuestion({
                            ...editingQuestion,
                            [field]: event.target.checked,
                          })
                        }
                      />
                      {field === 'isRequired' ? 'Required' : 'Active'}
                    </label>
                  ))}
                  <button className="ds-primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save Question'}
                  </button>{' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditingQuestion(null)}
                  >
                    Cancel edit
                  </button>
                </form>
              )}
            </>
          )}
          {['Export My Data', 'Backup Settings', 'Activity Sessions'].includes(
            panel,
          ) && (
            <Unconnected reason="No existing endpoint exposes this feature." />
          )}
          {error && (
            <p role="alert" className="ds-error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="ds-success">
              {message}
            </p>
          )}
          <footer>
            <button disabled={busy} onClick={close}>
              Close
            </button>
          </footer>
        </Drawer>
      )}
    </>
  );
}
