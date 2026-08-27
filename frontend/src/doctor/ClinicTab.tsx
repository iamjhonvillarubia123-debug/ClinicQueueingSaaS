import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api/client';

type Step = 1 | 2 | 3 | 4 | 5;
type ClinicStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED';
type Weekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

type ClinicDraft = {
  name: string;
  shortCode: string;
  address: string;
  country: string;
  timeZone: string;
  contactNumber: string;
  email: string;
  description: string;
};

export type DayHours = {
  day: string;
  open: boolean;
  opens: string;
  closes: string;
  maximumUntil: string;
};
type ClinicRecord = ClinicDraft & {
  id: string;
  status: ClinicStatus;
  hours: DayHours[];
  cutoffLeadHours: number;
};

type PracticeScheduleResponse = {
  weekday: Weekday;
  isOpen: boolean;
  opensAtLocal: string | null;
  closesAtLocal: string | null;
  maximumOnlineBookingUntilLocal: string | null;
  maximumOperatingUntilLocal: string | null;
};

type PracticeLocationResponse = {
  id: string;
  lifecycleStatus: ClinicStatus | 'PERMANENTLY_DELETED';
  name: string | null;
  addressLine1: string | null;
  contactNumber: string | null;
  countryCode: string | null;
  timeZone: string | null;
  practiceSchedules?: PracticeScheduleResponse[];
  doctorScheduleDraft?: { schedules: PracticeScheduleResponse[] } | null;
};

type ServiceRow = {
  id: number;
  name: string;
  description: string;
  minutes: number;
  active: boolean;
};
type QuestionRow = {
  id: number;
  order: number;
  question: string;
  type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
  required: boolean;
};

const initialDraft: ClinicDraft = {
  name: '',
  shortCode: '',
  address: '',
  country: 'Philippines',
  timeZone: 'Asia/Manila',
  contactNumber: '',
  email: '',
  description: '',
};

const initialHours: DayHours[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
].map((day, index) => ({
  day,
  open: index < 5,
  opens: index < 5 ? '08:00 AM' : '09:00 AM',
  closes: index < 5 ? '05:00 PM' : '01:00 PM',
  maximumUntil: index < 5 ? '06:00 PM' : '02:00 PM',
}));

const initialServices: ServiceRow[] = [
  {
    id: 1,
    name: 'General Consultation',
    description: 'Regular check-up and consultation',
    minutes: 30,
    active: true,
  },
  {
    id: 2,
    name: 'Follow-up Consultation',
    description: 'Follow-up check-up for existing patients',
    minutes: 20,
    active: true,
  },
];

const initialQuestions: QuestionRow[] = [
  {
    id: 1,
    order: 1,
    question: 'What is the reason for your visit?',
    type: 'SINGLE_SELECT',
    required: true,
  },
  {
    id: 2,
    order: 2,
    question: 'Have you had this condition before?',
    type: 'BOOLEAN',
    required: true,
  },
];

function clockMatch(value: string) {
  return value
    .trim()
    .toUpperCase()
    .match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s(AM|PM)$/);
}

function isValidClock(value: string) {
  return Boolean(clockMatch(value));
}

function parseClock(value: string) {
  const match = clockMatch(value);
  if (!match) return Number.NaN;
  let hour = Number(match[1]) % 12;
  const minute = Number(match[2]);
  if (match[3] === 'PM') hour += 12;
  return hour * 60 + minute;
}

function formatClock(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes)) return '—';
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`;
}

const quarterHourSuggestions = Array.from({ length: 96 }, (_, index) =>
  formatClock(index * 15),
);

function normalizeFlexibleClock(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = normalized.match(
    /^(0?[1-9]|1[0-2])(?:[:.]?([0-5]\d))?\s*(AM|PM)$/,
  );
  if (!match) return null;

  let hour = Number(match[1]) % 12;
  const minute = match[2] ? Number(match[2]) : 0;
  if (match[3] === 'PM') hour += 12;
  return formatClock(hour * 60 + minute);
}

function toApiLocalTime(value: string) {
  const total = parseClock(value);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function weekdayFor(day: string): Weekday {
  return day.toUpperCase() as Weekday;
}

function onlineCutoffFor(row: DayHours, leadHours: number) {
  const opening = parseClock(row.opens);
  const closing = parseClock(row.closes);
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) return '—';
  return formatClock(Math.max(opening, closing - leadHours * 60));
}

function fromApiLocalTime(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  const match = value.match(/(?:T|^)([0-2]\d):([0-5]\d)/);
  if (!match) return fallback;
  return formatClock(Number(match[1]) * 60 + Number(match[2]));
}

function hoursFromSchedules(schedules: PracticeScheduleResponse[] | undefined) {
  if (!schedules?.length) return initialHours.map((row) => ({ ...row }));
  return initialHours.map((fallback) => {
    const schedule = schedules.find(
      (row) => row.weekday === weekdayFor(fallback.day),
    );
    if (!schedule) return { ...fallback };
    const closes = fromApiLocalTime(schedule.closesAtLocal, fallback.closes);
    return {
      day: fallback.day,
      open: schedule.isOpen,
      opens: fromApiLocalTime(schedule.opensAtLocal, fallback.opens),
      closes,
      maximumUntil: fromApiLocalTime(
        schedule.maximumOperatingUntilLocal,
        closes,
      ),
    };
  });
}

function cutoffLeadHoursFromSchedules(
  schedules: PracticeScheduleResponse[] | undefined,
) {
  const schedule = schedules?.find(
    (row) =>
      row.isOpen && row.closesAtLocal && row.maximumOnlineBookingUntilLocal,
  );
  if (!schedule) return 2;
  const closing = parseClock(
    fromApiLocalTime(schedule.closesAtLocal, '12:00 AM'),
  );
  const cutoff = parseClock(
    fromApiLocalTime(schedule.maximumOnlineBookingUntilLocal, '12:00 AM'),
  );
  return Math.max(0, Math.min(12, Math.round((closing - cutoff) / 60)));
}

function toClinicRecord(
  location: PracticeLocationResponse,
): ClinicRecord | null {
  if (location.lifecycleStatus === 'PERMANENTLY_DELETED') return null;
  const editableSchedules = location.doctorScheduleDraft?.schedules?.length
    ? location.doctorScheduleDraft.schedules
    : location.practiceSchedules;
  return {
    id: location.id,
    name: location.name ?? '',
    shortCode: '',
    address: location.addressLine1 ?? '',
    country:
      location.countryCode === 'PH' || !location.countryCode
        ? 'Philippines'
        : location.countryCode,
    timeZone: location.timeZone ?? 'Asia/Manila',
    contactNumber: location.contactNumber ?? '',
    email: '',
    description: '',
    status: location.lifecycleStatus,
    hours: hoursFromSchedules(editableSchedules),
    cutoffLeadHours: cutoffLeadHoursFromSchedules(editableSchedules),
  };
}

function Stepper({ step }: { step: Step }) {
  const labels = [
    'Basic Info',
    'Clinic Hours',
    'Services',
    'Questions',
    'Review',
  ];
  return (
    <div className="clinic-stepper" aria-label="Clinic setup progress">
      {labels.map((label, index) => {
        const number = (index + 1) as Step;
        const complete = number < step;
        const current = number === step;
        return (
          <div className="clinic-step" key={label}>
            <span
              className={`clinic-step-dot${complete ? ' is-complete' : ''}${current ? ' is-current' : ''}`}
            >
              {complete ? '✓' : number}
            </span>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function SplitAction({
  primaryLabel,
  onPrimary,
  onDraft,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  onDraft: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<'PRIMARY' | 'DRAFT'>(
    'PRIMARY',
  );
  const selectedLabel =
    selectedAction === 'DRAFT' ? 'Save as Draft' : primaryLabel;
  const executeSelectedAction =
    selectedAction === 'DRAFT' ? onDraft : onPrimary;

  function choose(action: 'PRIMARY' | 'DRAFT') {
    setSelectedAction(action);
    setOpen(false);
  }

  return (
    <div className="clinic-split-action">
      <button
        className="clinic-primary clinic-split-main"
        type="button"
        onClick={executeSelectedAction}
      >
        {selectedLabel}
      </button>
      <button
        className="clinic-primary clinic-split-toggle"
        type="button"
        aria-label="Choose save action"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ⌄
      </button>
      {open ? (
        <div className="clinic-action-menu" role="menu">
          <button
            className={selectedAction === 'PRIMARY' ? 'is-selected' : ''}
            type="button"
            role="menuitem"
            onClick={() => choose('PRIMARY')}
          >
            <span className="clinic-action-label">{primaryLabel}</span>
            {selectedAction === 'PRIMARY' ? (
              <span className="clinic-action-check">✓</span>
            ) : null}
          </button>
          <button
            className={selectedAction === 'DRAFT' ? 'is-selected' : ''}
            type="button"
            role="menuitem"
            onClick={() => choose('DRAFT')}
          >
            <span className="clinic-action-label">Save as Draft</span>
            {selectedAction === 'DRAFT' ? (
              <span className="clinic-action-check">✓</span>
            ) : null}
            <small>You can continue later.</small>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BasicInformation({
  value,
  onChange,
}: {
  value: ClinicDraft;
  onChange: (next: ClinicDraft) => void;
}) {
  return (
    <div className="clinic-form-grid">
      <label>
        Clinic Name <b>*</b>
        <input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="Enter clinic name"
        />
      </label>
      <label>
        Short Code <small>(Optional)</small>
        <input
          value={value.shortCode}
          onChange={(e) => onChange({ ...value, shortCode: e.target.value })}
          placeholder="e.g. NORTH"
        />
      </label>
      <label className="clinic-field-wide">
        Address <b>*</b>
        <textarea
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
          placeholder="Enter complete address"
        />
      </label>
      <label>
        Country <b>*</b>
        <select
          value={value.country}
          onChange={(e) => onChange({ ...value, country: e.target.value })}
        >
          <option>Philippines</option>
          <option>Other</option>
        </select>
      </label>
      <label>
        Timezone <b>*</b>
        <select
          value={value.timeZone}
          onChange={(e) => onChange({ ...value, timeZone: e.target.value })}
        >
          <option value="Asia/Manila">(GMT+08:00) Asia/Manila</option>
        </select>
      </label>
      <label>
        Contact Number <small>(Optional)</small>
        <input
          value={value.contactNumber}
          onChange={(e) =>
            onChange({ ...value, contactNumber: e.target.value })
          }
          placeholder="Enter contact number"
        />
      </label>
      <label>
        Email <small>(Optional)</small>
        <input
          type="email"
          value={value.email}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
          placeholder="Enter email address"
        />
      </label>
      <label className="clinic-field-wide">
        Description <small>(Optional)</small>
        <textarea
          maxLength={250}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          placeholder="Brief description about this clinic"
        />
        <span className="clinic-count">{value.description.length} / 250</span>
      </label>
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m5 7.5 5 5 5-5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-7A1.5 1.5 0 0 0 3 5.5v7A1.5 1.5 0 0 0 4.5 14H7" />
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M7 5H5.5A1.5 1.5 0 0 0 4 6.5v9A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14" />
      <path d="M10 3h5a2 2 0 0 1 2 2v5M11 9l2.5 2.5L17 8" />
    </svg>
  );
}

function ClinicTimeInput({
  value,
  onChange,
  disabled,
  label,
  placeholder,
  open,
  onOpen,
  onClose,
  minimumMinutes,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label: string;
  placeholder: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  minimumMinutes?: number;
}) {
  const normalizedValue = normalizeFlexibleClock(value);
  const normalizedMinutes = normalizedValue
    ? parseClock(normalizedValue)
    : Number.NaN;
  const allowedValue =
    normalizedValue &&
    (!Number.isFinite(minimumMinutes) ||
      normalizedMinutes >= (minimumMinutes ?? 0))
      ? normalizedValue
      : null;
  const minimumFallback = Number.isFinite(minimumMinutes)
    ? formatClock(minimumMinutes ?? 0)
    : value;
  const lastValidValue = useRef(allowedValue ?? minimumFallback);
  if (allowedValue) lastValidValue.current = allowedValue;
  const availableSuggestions = Number.isFinite(minimumMinutes)
    ? quarterHourSuggestions.filter(
        (time) => parseClock(time) >= (minimumMinutes ?? 0),
      )
    : quarterHourSuggestions;

  function finishManualEntry() {
    if (allowedValue) onChange(allowedValue);
    else if (value.trim()) onChange(lastValidValue.current);
    onClose();
  }

  return (
    <div className="clinic-time-field">
      <input
        className="clinic-search clinic-time-input"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onOpen}
        onBlur={finishManualEntry}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'Enter') finishManualEntry();
          if (event.key === 'Tab') {
            const enabledTimeFields = Array.from(
              document.querySelectorAll<HTMLInputElement>(
                '.clinic-time-input:not(:disabled)',
              ),
            );
            const currentIndex = enabledTimeFields.indexOf(event.currentTarget);
            const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
            const nextTimeField = enabledTimeFields[nextIndex];
            if (nextTimeField) {
              event.preventDefault();
              finishManualEntry();
              nextTimeField.focus();
            }
          }
        }}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={Boolean(value.trim() && !allowedValue)}
        placeholder={placeholder}
        autoComplete="off"
        inputMode="text"
      />
      <button
        className="clinic-time-toggle"
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={`Choose ${label}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? onClose() : onOpen())}
      >
        <ChevronDownIcon />
      </button>
      {open && !disabled ? (
        <div
          className="clinic-time-menu"
          role="listbox"
          aria-label={`${label} choices`}
        >
          {availableSuggestions.map((time) => (
            <button
              className={time === allowedValue ? 'is-selected' : ''}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={time === allowedValue}
              key={time}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(time);
                onClose();
              }}
            >
              {time}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HoursEditor({
  hours,
  setHours,
  cutoffLeadHours,
  setCutoffLeadHours,
}: {
  hours: DayHours[];
  setHours: (hours: DayHours[]) => void;
  cutoffLeadHours: number;
  setCutoffLeadHours: (value: number) => void;
}) {
  const [copiedSchedule, setCopiedSchedule] = useState<{
    sourceDay: string;
    opens: string;
    closes: string;
    maximumUntil: string;
  } | null>(null);
  const [activeTimeField, setActiveTimeField] = useState<string | null>(null);
  const update = (index: number, patch: Partial<DayHours>) =>
    setHours(
      hours.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );

  function updateClosing(index: number, closes: string) {
    const closingMinutes = parseClock(closes);
    update(index, {
      closes,
      ...(Number.isFinite(closingMinutes)
        ? { maximumUntil: formatClock(closingMinutes) }
        : {}),
    });
  }

  function handleScheduleAction(index: number) {
    const row = hours[index];
    if (!row.open) return;

    if (copiedSchedule?.sourceDay === row.day) {
      setCopiedSchedule(null);
      return;
    }

    if (!copiedSchedule) {
      setCopiedSchedule({
        sourceDay: row.day,
        opens: row.opens,
        closes: row.closes,
        maximumUntil: row.maximumUntil,
      });
      return;
    }

    update(index, {
      opens: copiedSchedule.opens,
      closes: copiedSchedule.closes,
      maximumUntil: copiedSchedule.maximumUntil,
    });
  }

  return (
    <>
      <div className="clinic-hours-table has-schedule-actions">
        <div className="clinic-table-head">
          <span>Open</span>
          <span>Day</span>
          <span>Opens</span>
          <span>Closes</span>
          <span>Online Booking Cutoff</span>
          <span>Maximum Operating Until</span>
          <span>Actions</span>
        </div>
        {hours.map((row, index) => (
          <div
            className={`clinic-hours-row${row.open ? '' : ' is-closed'}`}
            key={row.day}
          >
            <label className="clinic-open-toggle">
              <input
                aria-label={`${row.day} open`}
                type="checkbox"
                checked={row.open}
                onChange={(e) => update(index, { open: e.target.checked })}
              />
              <span>Open</span>
            </label>
            <strong>{row.day.slice(0, 3)}</strong>
            <ClinicTimeInput
              disabled={!row.open}
              value={row.opens}
              onChange={(opens) => update(index, { opens })}
              label={`${row.day} opening time`}
              placeholder="e.g. 08:07 AM"
              open={activeTimeField === `${row.day}-opens`}
              onOpen={() => setActiveTimeField(`${row.day}-opens`)}
              onClose={() => setActiveTimeField(null)}
            />
            <ClinicTimeInput
              disabled={!row.open}
              value={row.closes}
              onChange={(closes) => updateClosing(index, closes)}
              label={`${row.day} closing time`}
              placeholder="e.g. 05:43 PM"
              open={activeTimeField === `${row.day}-closes`}
              onOpen={() => setActiveTimeField(`${row.day}-closes`)}
              onClose={() => setActiveTimeField(null)}
            />
            <output
              className="clinic-cutoff-output"
              aria-label={`${row.day} online booking cutoff`}
            >
              {row.open ? onlineCutoffFor(row, cutoffLeadHours) : '—'}
            </output>
            <ClinicTimeInput
              disabled={!row.open}
              value={row.maximumUntil}
              onChange={(maximumUntil) => update(index, { maximumUntil })}
              label={`${row.day} maximum operating time`}
              placeholder="e.g. 06:10 PM"
              open={activeTimeField === `${row.day}-maximum`}
              onOpen={() => setActiveTimeField(`${row.day}-maximum`)}
              onClose={() => setActiveTimeField(null)}
              minimumMinutes={parseClock(row.closes)}
            />
            <button
              className={`clinic-schedule-copy-action${copiedSchedule && copiedSchedule.sourceDay !== row.day ? ' is-paste' : ''}${copiedSchedule?.sourceDay === row.day ? ' is-source' : ''}`}
              type="button"
              disabled={!row.open}
              aria-label={
                copiedSchedule?.sourceDay === row.day
                  ? `End copying ${row.day} schedule`
                  : copiedSchedule
                    ? `Paste ${copiedSchedule.sourceDay} schedule to ${row.day}`
                    : `Copy ${row.day} schedule`
              }
              title={
                copiedSchedule?.sourceDay === row.day
                  ? `End copying ${row.day} schedule`
                  : copiedSchedule
                    ? `Paste ${copiedSchedule.sourceDay} schedule to ${row.day}`
                    : `Copy ${row.day} schedule`
              }
              onClick={() => handleScheduleAction(index)}
            >
              {copiedSchedule && copiedSchedule.sourceDay !== row.day ? (
                <PasteIcon />
              ) : (
                <CopyIcon />
              )}
            </button>
          </div>
        ))}
      </div>
      <div className="clinic-info-strip">
        ⓘ Quarter-hour times are suggested for convenience. You may type any
        exact valid time, for example 08:07 AM.
      </div>
      <div className="clinic-cutoff-setting">
        <div>
          <strong>Online booking cutoff</strong>
          <p>
            Calculated automatically for every open day from the clinic closing
            time.
          </p>
        </div>
        <label>
          <input
            type="number"
            min={0}
            max={12}
            step={1}
            value={cutoffLeadHours}
            onChange={(e) =>
              setCutoffLeadHours(Math.max(0, Number(e.target.value) || 0))
            }
          />
          <span>hours before clinic closing</span>
        </label>
      </div>
    </>
  );
}

function ServicesEditor({
  services,
  setServices,
}: {
  services: ServiceRow[];
  setServices: (value: ServiceRow[]) => void;
}) {
  function addService() {
    setServices([
      ...services,
      {
        id: Date.now(),
        name: 'New Service',
        description: 'Clinic-specific service',
        minutes: 30,
        active: true,
      },
    ]);
  }

  function updateService(id: number, patch: Partial<ServiceRow>) {
    setServices(
      services.map((service) =>
        service.id === id ? { ...service, ...patch } : service,
      ),
    );
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
      <div className="clinic-card-list">
        {services.map((service) => (
          <div className="clinic-list-row" key={service.id}>
            <div className="clinic-service-copy">
              <input
                className="clinic-service-name-input"
                aria-label={`Service name for ${service.name}`}
                value={service.name}
                onChange={(event) =>
                  updateService(service.id, { name: event.target.value })
                }
                placeholder="Service name"
              />
              <input
                className="clinic-service-description-input"
                aria-label={`Service description for ${service.name}`}
                value={service.description}
                onChange={(event) =>
                  updateService(service.id, { description: event.target.value })
                }
                placeholder="Short service description"
              />
            </div>
            <label className="clinic-inline-field">
              <span>Duration</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={service.minutes}
                onChange={(event) =>
                  updateService(service.id, {
                    minutes: Number(event.target.value),
                  })
                }
              />{' '}
              min
            </label>
            <button
              className={`clinic-status-pill${service.active ? ' is-active' : ''}`}
              type="button"
              onClick={() =>
                updateService(service.id, { active: !service.active })
              }
            >
              {service.active ? 'Active' : 'Inactive'}
            </button>
            <button
              className="clinic-kebab"
              type="button"
              aria-label={`Actions for ${service.name}`}
            >
              ⋮
            </button>
          </div>
        ))}
      </div>
      <div className="clinic-info-strip">
        ⓘ Service duration must be greater than 0 minutes and up to 24 hours
        (1,440 minutes).
      </div>
    </>
  );
}

function QuestionsEditor({
  questions,
  setQuestions,
}: {
  questions: QuestionRow[];
  setQuestions: (value: QuestionRow[]) => void;
}) {
  function addQuestion() {
    if (questions.length >= 5) return;
    setQuestions([
      ...questions,
      {
        id: Date.now(),
        order: questions.length + 1,
        question: 'New booking question',
        type: 'TEXT',
        required: false,
      },
    ]);
  }
  return (
    <>
      <div className="clinic-section-toolbar">
        <p>
          Add questions to ask patients during booking. Maximum 5 active
          questions.
        </p>
        <button
          className="clinic-secondary"
          disabled={questions.length >= 5}
          type="button"
          onClick={addQuestion}
        >
          + Add Question
        </button>
      </div>
      <div className="clinic-question-list">
        {questions.map((question) => (
          <div className="clinic-question-row" key={question.id}>
            <span className="clinic-order">{question.order}</span>
            <input
              className="clinic-question-input"
              value={question.question}
              onChange={(e) =>
                setQuestions(
                  questions.map((row) =>
                    row.id === question.id
                      ? { ...row, question: e.target.value }
                      : row,
                  ),
                )
              }
            />
            <select
              value={question.type}
              onChange={(e) =>
                setQuestions(
                  questions.map((row) =>
                    row.id === question.id
                      ? { ...row, type: e.target.value as QuestionRow['type'] }
                      : row,
                  ),
                )
              }
            >
              <option value="TEXT">Text</option>
              <option value="NUMBER">Number</option>
              <option value="BOOLEAN">Yes / No</option>
              <option value="SINGLE_SELECT">Single Choice</option>
            </select>
            <label className="clinic-check">
              <input
                type="checkbox"
                checked={question.required}
                onChange={(e) =>
                  setQuestions(
                    questions.map((row) =>
                      row.id === question.id
                        ? { ...row, required: e.target.checked }
                        : row,
                  ),
                )
              />{' '}
              Required
            </label>
            <button
              className="clinic-kebab"
              type="button"
              aria-label={`Actions for question ${question.order}`}
            >
              ⋮
            </button>
          </div>
        ))}
      </div>
      <div className="clinic-info-strip">
        ⓘ Supported question types: Text, Number, Yes / No, and Single Choice.
      </div>
    </>
  );
}

function Review({
  draft,
  hours,
  services,
  questions,
  cutoffLeadHours,
}: {
  draft: ClinicDraft;
  hours: DayHours[];
  services: ServiceRow[];
  questions: QuestionRow[];
  cutoffLeadHours: number;
}) {
  return (
    <div className="clinic-review-layout">
      <div className="clinic-review-stack">
        <div className="clinic-review-card">
          <h3>Basic Information</h3>
          <dl>
            <dt>Clinic Name</dt>
            <dd>{draft.name || 'Not entered'}</dd>
            <dt>Address</dt>
            <dd>{draft.address || 'Not entered'}</dd>
            <dt>Country</dt>
            <dd>{draft.country}</dd>
            <dt>Timezone</dt>
            <dd>{draft.timeZone}</dd>
            <dt>Contact Number</dt>
            <dd>{draft.contactNumber || 'Optional'}</dd>
          </dl>
        </div>
        <div className="clinic-review-card">
          <h3>Clinic Hours</h3>
          {hours
            .filter((row) => row.open)
            .map((row) => (
              <p key={row.day}>
                <strong>{row.day}</strong> {row.opens} – {row.closes} · Online
                cutoff {onlineCutoffFor(row, cutoffLeadHours)} · Max until{' '}
                {row.maximumUntil}
              </p>
            ))}
        </div>
        <div className="clinic-review-card">
          <h3>Services ({services.length})</h3>
          <p>
            {services.map((service) => service.name).join(' · ') ||
              'No services configured'}
          </p>
        </div>
        <div className="clinic-review-card">
          <h3>Booking Questions ({questions.length})</h3>
          <p>
            {questions.filter((question) => question.required).length} required,{' '}
            {questions.filter((question) => !question.required).length} optional
          </p>
        </div>
      </div>
      <aside className="clinic-readiness-card">
        <span className="clinic-ready-icon">✓</span>
        <h3>Activation Readiness</h3>
        <p>Your clinic can be activated once required items are complete.</p>
        <h4>Required for Activation</h4>
        <p className="clinic-ready-line">
          Clinic Hours <span>✓</span>
        </p>
        <h4>Optional Configuration</h4>
        <p className="clinic-ready-line">
          Services <span>○</span>
        </p>
        <p className="clinic-ready-line">
          Booking Questions <span>○</span>
        </p>
        <p className="clinic-ready-line">
          Secretaries <span>○</span>
        </p>
        <p className="clinic-ready-line">
          Public Information <span>○</span>
        </p>
      </aside>
    </div>
  );
}

function ClinicWizard({
  onExit,
  onSaved,
  initialValue,
  initialSchedule,
  initialCutoffLeadHours,
  editing,
  editingClinicId,
}: {
  onExit: () => void;
  onSaved: (
    clinic: ClinicDraft,
    status: ClinicStatus,
    hours: DayHours[],
    cutoffLeadHours: number,
  ) => Promise<void>;
  initialValue?: ClinicDraft;
  initialSchedule?: DayHours[];
  initialCutoffLeadHours?: number;
  editing?: boolean;
  editingClinicId?: string;
}) {
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState(initialValue ?? initialDraft);
  const [hours, setHours] = useState(initialSchedule ?? initialHours);
  const [cutoffLeadHours, setCutoffLeadHours] = useState(
    initialCutoffLeadHours ?? 2,
  );
  const [services, setServices] = useState(initialServices);
  const [questions, setQuestions] = useState(initialQuestions);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const title =
    step === 1
      ? editing
        ? 'Edit Clinic'
        : 'Add New Clinic'
      : step === 2
        ? 'Clinic Hours (Required)'
        : step === 3
          ? 'Services'
          : step === 4
            ? 'Booking Questions'
            : 'Review Your Clinic';
  const canContinue =
    step !== 1 ||
    Boolean(
      draft.name.trim() &&
      draft.address.trim() &&
      draft.country &&
      draft.timeZone,
    );

  async function saveDraft() {
    if (saving) return;
    setSaveError('');
    setSaving(true);
    try {
      await onSaved(draft, 'DRAFT', hours, cutoffLeadHours);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Unable to save this clinic draft.',
      );
    } finally {
      setSaving(false);
    }
  }

  function next() {
    setSaveError('');
    if (!canContinue) {
      const missing = [
        !draft.name.trim() ? 'Clinic Name' : '',
        !draft.address.trim() ? 'Address' : '',
        !draft.country ? 'Country' : '',
        !draft.timeZone ? 'Timezone' : '',
      ].filter(Boolean);
      setSaveError(
        `Complete the required fields before continuing: ${missing.join(', ')}.`,
      );
      return;
    }
    setStep(Math.min(5, step + 1) as Step);
  }

  async function validateHoursAndContinue() {
    if (saving) return;
    setSaveError('');

    const invalidFormatRow = hours.find(
      (row) =>
        row.open &&
        (!isValidClock(row.opens) ||
          !isValidClock(row.closes) ||
          !isValidClock(row.maximumUntil)),
    );
    if (invalidFormatRow) {
      setSaveError(
        `${invalidFormatRow.day} contains an invalid time. Use a time such as 08:07 AM.`,
      );
      return;
    }
    const invalidRow = hours.find(
      (row) => row.open && parseClock(row.closes) <= parseClock(row.opens),
    );
    if (invalidRow) {
      setSaveError(
        `${invalidRow.day} closing time must be later than its opening time.`,
      );
      return;
    }
    const invalidMaximumRow = hours.find(
      (row) =>
        row.open && parseClock(row.maximumUntil) < parseClock(row.closes),
    );
    if (invalidMaximumRow) {
      setSaveError(
        `${invalidMaximumRow.day} maximum operating time cannot be earlier than its closing time.`,
      );
      return;
    }
    if (!hours.some((row) => row.open)) {
      setSaveError('Select at least one open clinic day before continuing.');
      return;
    }

    setSaving(true);
    try {
      await apiRequest<{ valid: true }>(
        '/practice-location/schedule-preflight',
        {
          method: 'POST',
          body: {
            practiceLocationId: editingClinicId,
            timeZone: draft.timeZone,
            schedules: hours.map((row) => ({
              weekday: weekdayFor(row.day),
              isOpen: row.open,
              opensAtLocal: row.open ? toApiLocalTime(row.opens) : undefined,
              closesAtLocal: row.open ? toApiLocalTime(row.closes) : undefined,
            })),
          },
        },
      );
      setStep(3);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Clinic hours could not be validated.';
      setSaveError(
        `Cannot continue with these clinic hours. ${message} Adjust the schedule so it does not overlap another active clinic.`,
      );
    } finally {
      setSaving(false);
    }
  }

  const primaryAction =
    step === 5
      ? () => {
          void saveDraft();
        }
      : step === 2
        ? () => {
            void validateHoursAndContinue();
          }
        : next;

  return (
    <section className="clinic-page">
      <button className="clinic-back-link" type="button" onClick={onExit}>
        ← Back to Clinics
      </button>
      <div className="clinic-page-heading">
        <h1>{title}</h1>
        <p>
          {step === 1
            ? editing
              ? 'Update the basic clinic identity and location details.'
              : 'Enter the basic details of your clinic.'
            : step === 5
              ? 'Please review all information before creating your clinic.'
              : 'Configure this clinic now or save it as a draft and continue later.'}
        </p>
      </div>
      <Stepper step={step} />
      <div className="clinic-work-card">
        <div className="clinic-work-heading">
          <h2>{title}</h2>
          {step === 1 ? (
            <p>Start with the clinic identity and location details.</p>
          ) : null}
        </div>
        {step === 1 ? (
          <BasicInformation value={draft} onChange={setDraft} />
        ) : null}
        {step === 2 ? (
          <HoursEditor
            hours={hours}
            setHours={setHours}
            cutoffLeadHours={cutoffLeadHours}
            setCutoffLeadHours={setCutoffLeadHours}
          />
        ) : null}
        {step === 3 ? (
          <ServicesEditor services={services} setServices={setServices} />
        ) : null}
        {step === 4 ? (
          <QuestionsEditor questions={questions} setQuestions={setQuestions} />
        ) : null}
        {step === 5 ? (
          <Review
            draft={draft}
            hours={hours}
            services={services}
            questions={questions}
            cutoffLeadHours={cutoffLeadHours}
          />
        ) : null}
        {saveError ? (
          <div className="form-error" role="alert">
            {saveError}
          </div>
        ) : null}
        <div className="clinic-footer-actions">
          {step === 1 ? (
            <button className="clinic-secondary" type="button" onClick={onExit}>
              Cancel
            </button>
          ) : (
            <button
              className="clinic-secondary"
              type="button"
              onClick={() => setStep((step - 1) as Step)}
            >
              Back
            </button>
          )}
          <SplitAction
            primaryLabel={
              step === 5
                ? editing
                  ? 'Save Clinic'
                  : 'Create Clinic'
                : 'Save and Continue'
            }
            onPrimary={primaryAction}
            onDraft={() => {
              void saveDraft();
            }}
          />
        </div>
      </div>
    </section>
  );
}

function ClinicActionIcon({
  kind,
}: {
  kind: 'edit' | 'activate' | 'secretary' | 'disable' | 'delete';
}) {
  const paths = {
    edit: (
      <>
        <path d="M4 20h4l11-11-4-4L4 16v4Z" />
        <path d="m13.5 6.5 4 4" />
      </>
    ),
    activate: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4V8Z" />
      </>
    ),
    secretary: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      </>
    ),
    disable: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12h8" />
      </>
    ),
    delete: (
      <>
        <path d="M4 7h16" />
        <path d="m9 7 1-3h4l1 3" />
        <path d="m7 7 1 13h8l1-13" />
        <path d="M10 11v5M14 11v5" />
      </>
    ),
  };
  return (
    <svg
      className="clinic-row-action-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[kind]}
    </svg>
  );
}

type ClinicListAction =
  | 'OPEN'
  | 'EDIT'
  | 'ACTIVATE'
  | 'ASSIGN_SECRETARY'
  | 'DISABLE'
  | 'DELETE';

function defaultClinicListAction(clinic: ClinicRecord): ClinicListAction {
  return clinic.status === 'ACTIVE' ? 'OPEN' : 'EDIT';
}

function clinicListActionLabel(action: ClinicListAction) {
  switch (action) {
    case 'OPEN':
      return 'Open Clinic';
    case 'EDIT':
      return 'Edit Clinic';
    case 'ACTIVATE':
      return 'Activate Clinic';
    case 'ASSIGN_SECRETARY':
      return 'Assign Secretary';
    case 'DISABLE':
      return 'Disable Clinic';
    case 'DELETE':
      return 'Permanently Delete';
  }
}

function clinicListActionIcon(
  action: ClinicListAction,
): 'edit' | 'activate' | 'secretary' | 'disable' | 'delete' {
  switch (action) {
    case 'EDIT':
      return 'edit';
    case 'OPEN':
    case 'ACTIVATE':
      return 'activate';
    case 'ASSIGN_SECRETARY':
      return 'secretary';
    case 'DISABLE':
      return 'disable';
    case 'DELETE':
      return 'delete';
  }
}

function availableClinicListActions(clinic: ClinicRecord): ClinicListAction[] {
  return clinic.status === 'ACTIVE'
    ? ['OPEN', 'EDIT', 'ASSIGN_SECRETARY', 'DISABLE', 'DELETE']
    : ['EDIT', 'ACTIVATE', 'ASSIGN_SECRETARY', 'DELETE'];
}

function ClinicList({
  clinics,
  onAdd,
  onEdit,
}: {
  clinics: ClinicRecord[];
  onAdd: () => void;
  onEdit: (clinic: ClinicRecord) => void;
}) {
  const [filter, setFilter] = useState<'ALL' | ClinicStatus>('ALL');
  const [search, setSearch] = useState('');
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [selectedActionByClinic, setSelectedActionByClinic] = useState<
    Record<string, ClinicListAction>
  >({});

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!(event.target as Element).closest('.clinic-row-actions')) {
        setOpenActionMenuId(null);
      }
    }
    function closeMenuWithEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenActionMenuId(null);
    }
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeMenuWithEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeMenuWithEscape);
    };
  }, []);

  const filtered = useMemo(
    () =>
      clinics.filter(
        (clinic) =>
          (filter === 'ALL' || clinic.status === filter) &&
          clinic.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [clinics, filter, search],
  );

  function selectedActionFor(clinic: ClinicRecord) {
    return selectedActionByClinic[clinic.id] ?? defaultClinicListAction(clinic);
  }

  function selectAction(clinic: ClinicRecord, action: ClinicListAction) {
    setSelectedActionByClinic((current) => ({
      ...current,
      [clinic.id]: action,
    }));
    setOpenActionMenuId(null);
  }

  function executeSelectedAction(clinic: ClinicRecord) {
    const action = selectedActionFor(clinic);
    if (action === 'EDIT') onEdit(clinic);
  }

  return (
    <section className="clinic-page">
      <div className="clinic-list-heading">
        <div>
          <h1>Clinics</h1>
          <p>
            Manage your practice locations. You can view, edit, activate,
            disable, or continue setup.
          </p>
        </div>
        <button className="clinic-primary" type="button" onClick={onAdd}>
          + Add New Clinic
        </button>
      </div>
      <div className="clinic-list-controls">
        <div className="clinic-tabs">
          {(['ALL', 'ACTIVE', 'DRAFT', 'DISABLED'] as const).map((value) => (
            <button
              className={filter === value ? 'is-active' : ''}
              type="button"
              onClick={() => setFilter(value)}
              key={value}
            >
              {value === 'ALL'
                ? 'All Clinics'
                : value.charAt(0) + value.slice(1).toLowerCase()}{' '}
              <span>
                {value === 'ALL'
                  ? clinics.length
                  : clinics.filter((clinic) => clinic.status === value).length}
              </span>
            </button>
          ))}
        </div>
        <input
          className="clinic-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clinics…"
        />
      </div>
      <div className="clinic-table-card">
        {filtered.length === 0 ? (
          <div className="clinic-empty">
            <div className="clinic-empty-icon">+</div>
            <h2>No clinics yet</h2>
            <p>Create your first clinic to begin configuration.</p>
            <button className="clinic-primary" type="button" onClick={onAdd}>
              Add New Clinic
            </button>
          </div>
        ) : (
          filtered.map((clinic) => {
            const selectedAction = selectedActionFor(clinic);
            const selectedLabel = clinicListActionLabel(selectedAction);
            const executableNow = selectedAction === 'EDIT';
            return (
              <article className="clinic-clinic-row" key={clinic.id}>
                <div className="clinic-building-icon">+</div>
                <div className="clinic-clinic-copy">
                  <strong>
                    {clinic.name || 'Untitled Clinic'}{' '}
                    <span>{clinic.status}</span>
                  </strong>
                  <p>{clinic.address || 'Address not entered'}</p>
                  <small>
                    {clinic.country} · {clinic.timeZone}
                  </small>
                </div>
                <div>
                  <span
                    className={`clinic-status-pill${clinic.status === 'ACTIVE' ? ' is-active' : ''}`}
                  >
                    {clinic.status}
                  </span>
                  <small className="clinic-readiness">
                    {clinic.status === 'DRAFT' ? 'Ready to continue setup' : ''}
                  </small>
                </div>
                <div className="clinic-secretary">
                  <strong>Secretary</strong>
                  <span>Not assigned</span>
                </div>
                <div className="clinic-row-actions">
                  <button
                    className="clinic-row-action-main"
                    type="button"
                    aria-disabled={executableNow ? undefined : true}
                    title={
                      executableNow
                        ? undefined
                        : 'Available in a later implementation phase.'
                    }
                    onClick={() => executeSelectedAction(clinic)}
                  >
                    {selectedLabel}
                  </button>
                  <button
                    className="clinic-row-action-toggle"
                    type="button"
                    aria-label={`More actions for ${clinic.name}`}
                    aria-expanded={openActionMenuId === clinic.id}
                    onClick={() =>
                      setOpenActionMenuId((current) =>
                        current === clinic.id ? null : clinic.id,
                      )
                    }
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="m5 7.5 5 5 5-5" />
                    </svg>
                  </button>
                  {openActionMenuId === clinic.id ? (
                    <div className="clinic-row-action-menu" role="menu">
                      {availableClinicListActions(clinic).map((action) => (
                        <button
                          className={`${action === selectedAction ? 'is-selected' : ''}${action === 'DELETE' ? ' is-danger' : ''}`.trim()}
                          type="button"
                          role="menuitem"
                          key={action}
                          title={
                            action === 'EDIT'
                              ? undefined
                              : 'Available in a later implementation phase.'
                          }
                          onClick={() => selectAction(clinic, action)}
                        >
                          <ClinicActionIcon kind={clinicListActionIcon(action)} />
                          <span>{clinicListActionLabel(action)}</span>
                          {action === selectedAction ? (
                            <span className="clinic-action-check">✓</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

export function ClinicTabPage() {
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [editingClinic, setEditingClinic] = useState<ClinicRecord | null>(null);
  const [loadError, setLoadError] = useState('');

  async function loadClinics() {
    const locations =
      await apiRequest<PracticeLocationResponse[]>('/practice-location');
    const mapped = locations
      .map(toClinicRecord)
      .filter((clinic): clinic is ClinicRecord => clinic !== null);
    setClinics(mapped);
  }

  useEffect(() => {
    let cancelled = false;
    void apiRequest<PracticeLocationResponse[]>('/practice-location')
      .then((locations) => {
        if (cancelled) return;
        setClinics(
          locations
            .map(toClinicRecord)
            .filter((clinic): clinic is ClinicRecord => clinic !== null),
        );
        setLoadError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : 'Unable to load clinics.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saved(
    clinic: ClinicDraft,
    _status: ClinicStatus,
    hours: DayHours[],
    cutoffLeadHours: number,
  ) {
    let practiceLocationId: string;
    if (editingClinic) {
      practiceLocationId = editingClinic.id;
      await apiRequest<PracticeLocationResponse>(
        `/practice-location/${editingClinic.id}`,
        {
          method: 'PATCH',
          body: {
            name: clinic.name.trim() || undefined,
            addressLine1: clinic.address.trim() || undefined,
            contactNumber: clinic.contactNumber.trim() || undefined,
            countryCode:
              clinic.country === 'Philippines'
                ? 'PH'
                : clinic.country.slice(0, 2).toUpperCase(),
            timeZone: clinic.timeZone,
          },
        },
      );
    } else {
      const created = await apiRequest<PracticeLocationResponse>(
        '/practice-location',
        {
          method: 'POST',
          body: {
            name: clinic.name.trim() || undefined,
            addressLine1: clinic.address.trim() || undefined,
            contactNumber: clinic.contactNumber.trim() || undefined,
          },
        },
      );
      practiceLocationId = created.id;
      await apiRequest<PracticeLocationResponse>(
        `/practice-location/${practiceLocationId}`,
        {
          method: 'PATCH',
          body: {
            countryCode:
              clinic.country === 'Philippines'
                ? 'PH'
                : clinic.country.slice(0, 2).toUpperCase(),
            timeZone: clinic.timeZone,
          },
        },
      );
    }
    await apiRequest(
      `/practice-location/${practiceLocationId}/draft-schedule`,
      {
        method: 'PUT',
        body: {
          schedules: hours.map((row) => ({
            weekday: weekdayFor(row.day),
            isOpen: row.open,
            opensAtLocal: row.open ? toApiLocalTime(row.opens) : undefined,
            closesAtLocal: row.open ? toApiLocalTime(row.closes) : undefined,
            maximumOnlineBookingUntilLocal: row.open
              ? toApiLocalTime(onlineCutoffFor(row, cutoffLeadHours))
              : undefined,
            maximumOperatingUntilLocal: toApiLocalTime(row.maximumUntil),
          })),
        },
      },
    );
    await loadClinics();
    setEditingClinic(null);
    setMode('list');
  }

  if (mode === 'create')
    return <ClinicWizard onExit={() => setMode('list')} onSaved={saved} />;
  if (mode === 'edit' && editingClinic)
    return (
      <ClinicWizard
        editing
        editingClinicId={editingClinic.id}
        initialValue={editingClinic}
        initialSchedule={editingClinic.hours}
        initialCutoffLeadHours={editingClinic.cutoffLeadHours}
        onExit={() => {
          setEditingClinic(null);
          setMode('list');
        }}
        onSaved={saved}
      />
    );
  return (
    <>
      {loadError ? (
        <div className="form-error" role="alert">
          {loadError}
        </div>
      ) : null}
      <ClinicList
        clinics={clinics}
        onAdd={() => {
          setEditingClinic(null);
          setMode('create');
        }}
        onEdit={(clinic) => {
          setEditingClinic(clinic);
          setMode('edit');
        }}
      />
    </>
  );
}
