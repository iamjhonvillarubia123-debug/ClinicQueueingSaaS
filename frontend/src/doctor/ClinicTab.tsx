import { createPortal } from 'react-dom';
import { OperationsIcon } from './OperationsIcon';
import clinicIllustration from '../assets/clinic-illustration.png';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { ActivateClinicDialog } from './ActivateClinicDialog';
import { ApplyClinicChangesDialog } from './ApplyClinicChangesDialog';
import { DisableClinicDialog } from './DisableClinicDialog';
import { PermanentlyDeleteClinicDialog } from './PermanentlyDeleteClinicDialog';
import { QuestionManagementEditor } from './QuestionManagementEditor';
import { ServiceManagementEditor } from './ServiceManagementEditor';
import {
  ClinicOperationsWorkspace,
  type ClinicOperationsOverview,
  type ClinicOperationsQueue,
  type ClinicOperationsEvent,
} from './ClinicOperationsWorkspace';
import type { QueueDrawerBookingConfiguration } from './QueueActionDrawer';
import type { AppointmentDetailsModel } from './AppointmentDetailsDrawer';

export function formatClinicShortCode(value: string) {
  return value.trim().replace(/\s+/g, '-').toUpperCase();
}

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
  clinicPhoto?: string;
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

type ServiceRow = {
  id: string | number;
  effectiveServiceId?: string;
  sourceDoctorServiceTemplateId?: string;
  name: string;
  description: string;
  minutes: number;
  active: boolean;
};

type QuestionOption = {
  value: string;
  label: string;
};

type QuestionRow = {
  id: string | number;
  effectiveBookingQuestionId?: string;
  sourceDoctorBookingQuestionTemplateId?: string;
  order: number;
  question: string;
  type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SINGLE_SELECT';
  required: boolean;
  active: boolean;
  options?: QuestionOption[];
};

type ClinicEditorState = {
  draft: ClinicDraft;
  hours: DayHours[];
  cutoffLeadHours: number;
  services: ServiceRow[];
  questions: QuestionRow[];
};

type SavedClinicDraftState = {
  id: string;
  services: ServiceRow[];
  questions: QuestionRow[];
};

type ClinicRecord = ClinicDraft & {
  secretaryName?: string;
  savedHours?: DayHours[];
  id: string;
  status: ClinicStatus;
  editor: ClinicEditorState;
};

type PracticeScheduleResponse = {
  weekday: Weekday;
  isOpen: boolean;
  opensAtLocal: string | null;
  closesAtLocal: string | null;
  maximumOnlineBookingUntilLocal: string | null;
  maximumOperatingUntilLocal: string | null;
};

type PracticeServiceResponse = {
  id: string;
  sourceDoctorServiceTemplateId?: string | null;
  effectiveServiceId?: string | null;
  name: string;
  description?: string | null;
  durationMinutes: number;
  status: 'ACTIVE' | 'INACTIVE';
};

type BookingQuestionResponse = {
  id: string;
  effectiveBookingQuestionId?: string | null;
  sourceDoctorBookingQuestionTemplateId?: string | null;
  questionText: string;
  type: QuestionRow['type'];
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  selectOptions?: unknown;
};

type DoctorConfigurationDraftResponse = {
  clinicPhoto?: string | null;
  name: string | null;
  shortCode: string | null;
  addressLine1: string | null;
  addressLine2?: string | null;
  cityMunicipality?: string | null;
  province?: string | null;
  postalCode?: string | null;
  contactNumber: string | null;
  clinicEmail: string | null;
  clinicDescription: string | null;
  countryCode: string | null;
  timeZone: string | null;
  schedules: PracticeScheduleResponse[];
  services: PracticeServiceResponse[];
  bookingQuestions: BookingQuestionResponse[];
};

type PracticeLocationResponse = {
  clinicPhoto?: string | null;
  currentRegularPracticeStaff?: { isActive: boolean; user: { firstName: string; lastName: string } } | null;
  id: string;
  lifecycleStatus: ClinicStatus | 'PERMANENTLY_DELETED';
  name: string | null;
  shortCode?: string | null;
  addressLine1: string | null;
  contactNumber: string | null;
  clinicEmail?: string | null;
  clinicDescription?: string | null;
  countryCode: string | null;
  timeZone: string | null;
  services?: PracticeServiceResponse[];
  bookingQuestions?: BookingQuestionResponse[];
  practiceSchedules?: PracticeScheduleResponse[];
  doctorScheduleDraft?: DoctorConfigurationDraftResponse | null;
};

type DoctorAccountSettingsResponse = {
  defaultTimeZone: string;
};

const FALLBACK_TIME_ZONE = 'Asia/Manila';

type TimeZoneChoice = {
  value: string;
};

const CURATED_TIME_ZONES: TimeZoneChoice[] = [
  { value: 'America/Los_Angeles' },
  { value: 'America/Denver' },
  { value: 'America/Chicago' },
  { value: 'America/New_York' },
  { value: 'America/Toronto' },
  { value: 'Europe/London' },
  { value: 'Europe/Paris' },
  { value: 'Europe/Berlin' },
  { value: 'Asia/Dubai' },
  { value: 'Asia/Kolkata' },
  { value: 'Asia/Bangkok' },
  { value: 'Asia/Hong_Kong' },
  { value: 'Asia/Kuala_Lumpur' },
  { value: 'Asia/Manila' },
  { value: 'Asia/Singapore' },
  { value: 'Asia/Taipei' },
  { value: 'Asia/Seoul' },
  { value: 'Asia/Tokyo' },
  { value: 'Australia/Brisbane' },
  { value: 'Australia/Sydney' },
  { value: 'Pacific/Auckland' },
];

function timeZoneOffset(timeZone: string) {
  try {
    const timeZoneName = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!timeZoneName || timeZoneName === 'GMT') return '+00:00';
    return timeZoneName.replace('GMT', '');
  } catch {
    return '';
  }
}

function timeZoneOffsetMinutes(timeZone: string) {
  const offset = timeZoneOffset(timeZone);
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function timeZoneLabel(timeZone: string) {
  const offset = timeZoneOffset(timeZone);
  return offset ? `(GMT${offset}) ${timeZone}` : timeZone;
}

function sortedTimeZoneChoices(choices: TimeZoneChoice[]) {
  return [...choices].sort((left, right) => {
    const offsetDifference =
      timeZoneOffsetMinutes(left.value) - timeZoneOffsetMinutes(right.value);
    if (offsetDifference !== 0) return offsetDifference;
    return left.value.localeCompare(right.value);
  });
}

function TimeZonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (timeZone: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const choices = useMemo(() => {
    const currentIsCurated = CURATED_TIME_ZONES.some(
      (choice) => choice.value === value,
    );
    const allChoices =
      currentIsCurated || !value
        ? CURATED_TIME_ZONES
        : [{ value }, ...CURATED_TIME_ZONES];
    return sortedTimeZoneChoices(allChoices);
  }, [value]);

  const filteredChoices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return choices;
    return choices.filter((choice) =>
      [choice.value, timeZoneLabel(choice.value)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [choices, query]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setQuery('');
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function selectTimeZone(timeZone: string) {
    onChange(timeZone);
    setOpen(false);
    setQuery('');
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%' }}
    >
      <button
        className="clinic-timezone-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="clinic-timezone-trigger-value">
          <span className="clinic-timezone-clock" aria-hidden="true">
            ◷
          </span>
          <span>{timeZoneLabel(value)}</span>
        </span>
        <span className="clinic-timezone-chevron" aria-hidden="true">
          {open ? '⌃' : '⌄'}
        </span>
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 50,
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            border: '1px solid #d7dce2',
            borderRadius: 10,
            background: '#fff',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.12)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: 10, borderBottom: '1px solid #eceff2' }}>
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search city or timezone"
              aria-label="Search timezone"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                minHeight: 40,
                padding: '0 11px',
                border: '1px solid #d7dce2',
                borderRadius: 7,
                font: 'inherit',
              }}
            />
          </div>
          <div
            role="listbox"
            aria-label="Timezone options"
            style={{ maxHeight: 300, overflowY: 'auto', padding: 6 }}
          >
            {filteredChoices.length ? (
              filteredChoices.map((choice) => {
                const selected = choice.value === value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectTimeZone(choice.value)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '9px 10px',
                      border: 0,
                      borderRadius: 7,
                      background: selected ? '#f2f4f6' : '#fff',
                      color: '#17191c',
                      font: 'inherit',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span>{timeZoneLabel(choice.value)}</span>
                    {selected ? <span aria-hidden="true">✓</span> : null}
                  </button>
                );
              })
            ) : (
              <div
                style={{
                  padding: '16px 12px',
                  color: '#6b7280',
                  fontSize: 14,
                }}
              >
                No matching timezone.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

const initialServices: ServiceRow[] = [];
const initialQuestions: QuestionRow[] = [];

function readClinicEditNavigation(): { clinicId: string | null; step: Step } {
  const params = new URLSearchParams(window.location.search);
  const clinicId = params.get('clinic');
  const candidateStep = Number(params.get('step'));
  const step =
    Number.isInteger(candidateStep) && candidateStep >= 1 && candidateStep <= 5
      ? (candidateStep as Step)
      : 1;
  return { clinicId, step };
}

function writeClinicEditNavigation(clinicId: string | null, step: Step = 1) {
  const url = new URL(window.location.href);
  if (clinicId) {
    url.searchParams.set('clinic', clinicId);
    url.searchParams.set('step', String(step));
  } else {
    url.searchParams.delete('clinic');
    url.searchParams.delete('step');
  }
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

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

function countryName(countryCode: string | null | undefined) {
  return countryCode === 'PH' || !countryCode ? 'Philippines' : countryCode;
}

function basicInfoFromLocation(
  location: PracticeLocationResponse,
): ClinicDraft {
  return {
    clinicPhoto: location.clinicPhoto ?? '',
    name: location.name ?? '',
    shortCode: location.shortCode ?? '',
    address: location.addressLine1 ?? '',
    country: countryName(location.countryCode),
    timeZone: location.timeZone ?? 'Asia/Manila',
    contactNumber: location.contactNumber ?? '',
    email: location.clinicEmail ?? '',
    description: location.clinicDescription ?? '',
  };
}

function basicInfoFromDoctorDraft(
  draft: DoctorConfigurationDraftResponse,
): ClinicDraft {
  return {
    clinicPhoto: draft.clinicPhoto ?? '',
    name: draft.name ?? '',
    shortCode: draft.shortCode ?? '',
    address: draft.addressLine1 ?? '',
    country: countryName(draft.countryCode),
    timeZone: draft.timeZone ?? 'Asia/Manila',
    contactNumber: draft.contactNumber ?? '',
    email: draft.clinicEmail ?? '',
    description: draft.clinicDescription ?? '',
  };
}

function servicesFromResponse(
  services: PracticeServiceResponse[] | undefined,
  fromDraft: boolean,
): ServiceRow[] {
  return (services ?? []).map((service) => ({
    id: service.id,
    effectiveServiceId: fromDraft
      ? (service.effectiveServiceId ?? undefined)
      : service.id,
    sourceDoctorServiceTemplateId:
      service.sourceDoctorServiceTemplateId ?? undefined,
    name: service.name,
    description: service.description ?? '',
    minutes: service.durationMinutes,
    active: service.status === 'ACTIVE',
  }));
}

function selectOptionsFromResponse(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((option) => {
    if (!option || typeof option !== 'object') return [];
    const candidate = option as { value?: unknown; label?: unknown };
    if (
      typeof candidate.value !== 'string' ||
      typeof candidate.label !== 'string'
    ) {
      return [];
    }
    return [{ value: candidate.value, label: candidate.label }];
  });
}

function questionsFromResponse(
  questions: BookingQuestionResponse[] | undefined,
  fromDraft: boolean,
): QuestionRow[] {
  return (questions ?? []).map((question) => ({
    id: question.id,
    effectiveBookingQuestionId: fromDraft
      ? (question.effectiveBookingQuestionId ?? undefined)
      : question.id,
    sourceDoctorBookingQuestionTemplateId:
      question.sourceDoctorBookingQuestionTemplateId ?? undefined,
    order: question.displayOrder,
    question: question.questionText,
    type: question.type,
    required: question.isRequired,
    active: question.isActive,
    options:
      question.type === 'SINGLE_SELECT'
        ? selectOptionsFromResponse(question.selectOptions)
        : [],
  }));
}

function toClinicRecord(
  location: PracticeLocationResponse,
): ClinicRecord | null {
  if (location.lifecycleStatus === 'PERMANENTLY_DELETED') return null;

  const effectiveDraft = basicInfoFromLocation(location);
  const doctorDraft = location.doctorScheduleDraft ?? null;
  const hasWholeDoctorDraft = Boolean(doctorDraft?.timeZone);
  const editorSchedules = doctorDraft?.schedules?.length
    ? doctorDraft.schedules
    : location.practiceSchedules;
  const editorDraft =
    hasWholeDoctorDraft && doctorDraft
      ? basicInfoFromDoctorDraft(doctorDraft)
      : effectiveDraft;
  const editorServices =
    hasWholeDoctorDraft && doctorDraft
      ? servicesFromResponse(doctorDraft.services, true)
      : servicesFromResponse(location.services, false);
  const editorQuestions =
    hasWholeDoctorDraft && doctorDraft
      ? questionsFromResponse(doctorDraft.bookingQuestions, true)
      : questionsFromResponse(location.bookingQuestions, false);

  return {
    id: location.id,
    ...effectiveDraft,
    savedHours: location.practiceSchedules?.length ? hoursFromSchedules(location.practiceSchedules) : [],
    status: location.lifecycleStatus,
    secretaryName: location.currentRegularPracticeStaff?.isActive ? [location.currentRegularPracticeStaff.user.firstName, location.currentRegularPracticeStaff.user.lastName].filter(Boolean).join(" ") : undefined,
    editor: {
      draft: editorDraft,
      hours: hoursFromSchedules(editorSchedules),
      cutoffLeadHours: cutoffLeadHoursFromSchedules(editorSchedules),
      services: editorServices,
      questions: editorQuestions,
    },
  };
}

function Stepper({ step, completedSteps, onNavigate, disabled }: {
  step: Step;
  completedSteps: Step[];
  onNavigate: (step: Step) => void;
  disabled: boolean;
}) {
  const labels = [
    'Basic Information',
    'Clinic Hours',
    'Clinic Services',
    'Clinic Questions',
    'Review',
  ];
  return (
    <div className="clinic-stepper" aria-label="Clinic setup progress">
      {labels.map((label, index) => {
        const number = (index + 1) as Step;
        const complete = completedSteps.includes(number) && number !== step;
        const current = number === step;
        return (
          <div className="clinic-step" key={label}>
            <button
              type="button"
              aria-label={`Go to ${label}`}
              aria-current={current ? 'step' : undefined}
              disabled={disabled}
              onClick={() => onNavigate(number)}
              className={`clinic-step-dot${complete ? ' is-complete' : ''}${current ? ' is-current' : ''}`}
            >
              {complete ? '✓' : number}
            </button>
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
  const photoInput = useRef<HTMLInputElement>(null);
  const photo = value.clinicPhoto;
  const currentValue = useRef(value);
  currentValue.current = value;
  const photoSelection = useRef(0);
  function setPhoto(next: string | null) { onChange({ ...currentValue.current, clinicPhoto: next ?? "" }); }
  const [photoError, setPhotoError] = useState('');
  useEffect(() => () => { photoSelection.current += 1; }, []);
  function choosePhoto(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setPhotoError('Choose a JPG or PNG image no larger than 5 MB.');
      return;
    }
    setPhotoError('');
    const selection = ++photoSelection.current;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        if (selection !== photoSelection.current) return;
        const scale = Math.min(1, 640 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image processing unavailable');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const encoded = canvas.toDataURL('image/jpeg', 0.8);
        if (encoded.length > 400000) throw new Error('Image too large');
        setPhoto(encoded);
      } catch { setPhotoError('This image could not be prepared. Choose another JPG or PNG.'); }
      finally { URL.revokeObjectURL(url); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); if (selection === photoSelection.current) setPhotoError('This image could not be opened. Choose another JPG or PNG.'); };
    image.src = url;
  }
  return (
    <div className="clinic-form-grid clinic-basic-layout">
      <label>
        Clinic Name <b>*</b>
        <input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          placeholder="Enter clinic name"
        />
      </label>
      <label>
        Branch Name <small>(Optional)</small>
        <input
          value={value.shortCode.replace(/[-_]+/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}
          onChange={(e) => onChange({ ...value, shortCode: e.target.value })}
          placeholder="e.g. Bajada Branch"
          maxLength={40}
          aria-describedby="clinic-short-code-help"
        />
        <small id="clinic-short-code-help">Enter a branch name to identify this clinic (up to 40 characters).</small>
      </label>
      <label className="clinic-field-wide">
        Location / Address <b>*</b>
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
        <TimeZonePicker
          value={value.timeZone}
          onChange={(timeZone) => onChange({ ...value, timeZone })}
        />
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
      <section className="clinic-photo-section" aria-label="Clinic photo upload and preview">
        <div className="clinic-photo-heading"><strong>Clinic Photo <small>(Optional)</small></strong><small>Upload a clear photo to help patients recognize this clinic.</small></div>
      <div className="clinic-photo-picker">
        <div className="clinic-photo-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choosePhoto(event.dataTransfer.files[0]); }}>
          <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="3"/><circle cx="11" cy="11" r="2"/><path d="m4 25 8-9 6 6 4-5 7 9"/></svg>
          <span>Drag and drop an image here<br />or</span>
          <button type="button" className="clinic-secondary" onClick={() => photoInput.current?.click()}>Upload Photo</button>
          <input ref={photoInput} type="file" accept="image/jpeg,image/png" aria-label="Clinic photo" hidden onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
        <small>JPG or PNG, max 5 MB. Your photo is saved with the clinic configuration.</small>
        {photoError ? <p role="alert" className="form-error">{photoError}</p> : null}
      </div>
      <div className="clinic-photo-preview">
        <div className="clinic-photo-frame">
          {photo ? <img src={photo} alt="Selected clinic photo preview" onError={() => { setPhoto(null); setPhotoError('This image could not be opened. Choose another JPG or PNG.'); }} /> : <img src={clinicIllustration} alt="Clinic illustration" />}
          <small>{photo ? 'Selected photo preview' : 'Image preview will appear here.'}</small>
        </div>
        {photo ? <button className="clinic-back-link" type="button" onClick={() => { photoSelection.current += 1; setPhoto(null); }}>Remove photo</button> : null}
      </div>
      </section>
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
          <span>Maximum Operating Time</span>
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
              <span>{row.open ? 'Open' : 'Closed'}</span>
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
      <div className="clinic-cutoff-setting clinic-hours-cutoff">
        <div>
          <strong className="clinic-cutoff-title">
            Online Booking Cutoff
            <span className="clinic-cutoff-info">
              <button type="button" className="clinic-cutoff-info-trigger" aria-label="About online booking cutoff" aria-describedby="clinic-cutoff-tooltip">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v6" />
                  <circle className="clinic-cutoff-info-dot" cx="12" cy="7.5" r="1" />
                </svg>
              </button>
              <span className="clinic-cutoff-tooltip" id="clinic-cutoff-tooltip" role="tooltip">
                The system will automatically compute the online booking cutoff for each open day based on your closing time and this setting.
              </span>
            </span>
          </strong>
          <p>
            Stop accepting online bookings this many hours before the clinic closing time.
          </p>
        </div>
        <label>
          <span>hours</span>
          <input
            aria-label="Online booking cutoff hours"
            type="number"
            min={0}
            max={12}
            step={1}
            value={cutoffLeadHours}
            onChange={(e) =>
              setCutoffLeadHours(Math.min(12, Math.max(0, Number(e.target.value) || 0)))
            }
          />
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
  return (
    <ServiceManagementEditor services={services} setServices={setServices} />
  );
}

function QuestionsEditor({
  questions,
  setQuestions,
}: {
  questions: QuestionRow[];
  setQuestions: (value: QuestionRow[]) => void;
}) {
  return (
    <QuestionManagementEditor
      questions={questions}
      setQuestions={setQuestions}
    />
  );
}

function reviewQuestionType(type: QuestionRow['type']) {
  if (type === 'NUMBER') return 'Number';
  if (type === 'BOOLEAN') return 'Yes / No';
  if (type === 'SINGLE_SELECT') return 'Single Choice';
  return 'Text';
}

function Review({
  draft,
  hours,
  services,
  questions,
  cutoffLeadHours,
  onEdit,
}: {
  draft: ClinicDraft;
  hours: DayHours[];
  services: ServiceRow[];
  questions: QuestionRow[];
  cutoffLeadHours: number;
  onEdit: (step: Step) => void;
}) {
  const openHours = hours.filter((row) => row.open);
  const clinicHoursReady =
    openHours.length > 0 &&
    openHours.every(
      (row) =>
        isValidClock(row.opens) &&
        isValidClock(row.closes) &&
        isValidClock(row.maximumUntil) &&
        parseClock(row.closes) > parseClock(row.opens) &&
        parseClock(row.maximumUntil) >= parseClock(row.closes),
    );
  const servicesConfigured = services.length > 0;
  const questionsConfigured = questions.length > 0;
  const publicInformationConfigured = Boolean(
    draft.contactNumber.trim() ||
    draft.email.trim() ||
    draft.description.trim(),
  );
  const activeServices = services.filter((service) => service.active).length;
  const activeQuestions = questions.filter(
    (question) => question.active,
  ).length;

  function readinessMark(complete: boolean) {
    return (
      <span
        className={
          complete
            ? 'clinic-readiness-check is-complete'
            : 'clinic-readiness-check'
        }
      >
        {complete ? '✓' : '○'}
      </span>
    );
  }

  function reviewHeader(title: string, step: Step) {
    return (
      <div className="clinic-review-card-heading">
        <h3>{title}</h3>
        <button
          className="clinic-review-edit"
          type="button"
          onClick={() => onEdit(step)}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="clinic-review-layout">
      <section
        className="clinic-readiness-card"
        aria-label="Activation readiness"
      >
        <div className="clinic-readiness-heading">
          <div>
            <h3>Activation Readiness</h3>
            <p>
              Clinic Hours are required for activation. Other items are optional
              configuration.
            </p>
          </div>
          <span
            className={`clinic-ready-icon${clinicHoursReady ? ' is-ready' : ''}`}
          >
            {clinicHoursReady ? '✓' : '○'}
          </span>
        </div>
        <div className="clinic-readiness-grid">
          <div className="clinic-readiness-item">
            {readinessMark(clinicHoursReady)}
            <div>
              <strong>Clinic Hours</strong>
              <small>{clinicHoursReady ? 'Configured' : 'Required'}</small>
            </div>
          </div>
          <div className="clinic-readiness-item">
            {readinessMark(servicesConfigured)}
            <div>
              <strong>Services</strong>
              <small>{servicesConfigured ? 'Configured' : 'Optional'}</small>
            </div>
          </div>
          <div className="clinic-readiness-item">
            {readinessMark(questionsConfigured)}
            <div>
              <strong>Booking Questions</strong>
              <small>{questionsConfigured ? 'Configured' : 'Optional'}</small>
            </div>
          </div>
          <div className="clinic-readiness-item">
            {readinessMark(false)}
            <div>
              <strong>Secretaries</strong>
              <small>Optional · not connected here</small>
            </div>
          </div>
          <div className="clinic-readiness-item">
            {readinessMark(publicInformationConfigured)}
            <div>
              <strong>Public Information</strong>
              <small>
                {publicInformationConfigured ? 'Configured' : 'Optional'}
              </small>
            </div>
          </div>
        </div>
        <div
          className={`clinic-readiness-summary${clinicHoursReady ? ' is-ready' : ''}`}
        >
          <strong>
            {clinicHoursReady
              ? 'Ready for activation'
              : 'Clinic Hours still required'}
          </strong>
          <span>
            {clinicHoursReady
              ? 'Optional configuration can be completed now or later.'
              : 'Add at least one valid clinic-hours schedule before activation.'}
          </span>
        </div>
      </section>

      <div className="clinic-review-stack">
        <div className="clinic-review-card">
          {reviewHeader('Basic Information', 1)}
          <dl className="clinic-review-basic-grid">
            <dt>Clinic Name</dt>
            <dd>{draft.name || 'Not entered'}</dd>
            <dt>Branch Name</dt>
            <dd>{draft.shortCode || 'Not entered'}</dd>
            <dt>Address</dt>
            <dd>{draft.address || 'Not entered'}</dd>
            <dt>Country</dt>
            <dd>{draft.country}</dd>
            <dt>Timezone</dt>
            <dd>{draft.timeZone}</dd>
          </dl>
        </div>

        <div className="clinic-review-card">
          {reviewHeader('Clinic Hours', 2)}
          {openHours.length ? (
            <div
              className="clinic-review-hours"
              role="table"
              aria-label="Clinic hours summary"
            >
              <div className="clinic-review-hours-head" role="row">
                <span>Day</span>
                <span>Clinic Hours</span>
                <span>Online Cutoff</span>
                <span>Maximum Until</span>
              </div>
              {openHours.map((row) => (
                <div
                  className="clinic-review-hours-row"
                  role="row"
                  key={row.day}
                >
                  <strong>{row.day}</strong>
                  <span>
                    {row.opens} – {row.closes}
                  </span>
                  <span>{onlineCutoffFor(row, cutoffLeadHours)}</span>
                  <span>{row.maximumUntil}</span>
                </div>
              ))}
            </div>
          ) : (
            <p>No clinic hours configured.</p>
          )}
        </div>

        <div className="clinic-review-card">
          {reviewHeader(`Services (${services.length})`, 3)}
          {services.length ? (
            <div className="clinic-review-detail-list">
              <div className="clinic-review-service-head">
                <span>Service</span>
                <span>Duration</span>
                <span>Status</span>
              </div>
              {services.map((service) => (
                <div className="clinic-review-detail-row" key={service.id}>
                  <div>
                    <strong>{service.name}</strong>
                    {service.description ? (
                      <small>{service.description}</small>
                    ) : null}
                  </div>
                  <span>{service.minutes} min</span>
                  <span
                    className={`clinic-review-state${service.active ? ' is-active' : ''}`}
                  >
                    {service.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
              <p className="clinic-review-count-note">
                {activeServices} active · {services.length - activeServices}{' '}
                inactive
              </p>
            </div>
          ) : (
            <p>No services configured.</p>
          )}
        </div>

        <div className="clinic-review-card">
          {reviewHeader(`Booking Questions (${questions.length})`, 4)}
          {questions.length ? (
            <div className="clinic-review-detail-list">
              <div className="clinic-review-question-head">
                <span>Question</span>
                <span>Type</span>
                <span>Required</span>
                <span>Status</span>
              </div>
              {[...questions]
                .sort((a, b) => a.order - b.order)
                .map((question) => (
                  <div className="clinic-review-question-row" key={question.id}>
                    <div>
                      <strong>{question.question}</strong>
                      {question.type === 'SINGLE_SELECT' &&
                      question.options?.length ? (
                        <small>
                          Options:{' '}
                          {question.options
                            .map((option) => option.label)
                            .join(', ')}
                        </small>
                      ) : null}
                    </div>
                    <span>{reviewQuestionType(question.type)}</span>
                    <span>{question.required ? 'Required' : 'Optional'}</span>
                    <span
                      className={`clinic-review-state${question.active ? ' is-active' : ''}`}
                    >
                      {question.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                ))}
              <p className="clinic-review-count-note">
                {activeQuestions} active ·{' '}
                {questions.filter((question) => question.required).length}{' '}
                required
              </p>
            </div>
          ) : (
            <p>No booking questions configured.</p>
          )}
        </div>

        <div className="clinic-review-card">
          {reviewHeader('Public Information', 1)}
          <dl className="clinic-review-public-grid">
            <dt>Contact Number</dt>
            <dd>{draft.contactNumber || 'Not entered'}</dd>
            <dt>Email</dt>
            <dd>{draft.email || 'Not entered'}</dd>
            <dt>Description</dt>
            <dd>{draft.description || 'Not entered'}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

function ClinicWizard({
  onExit,
  onSaved,
  onApplied,
  initialValue,
  initialSchedule,
  initialCutoffLeadHours,
  initialServices: initialServiceRows,
  initialQuestions: initialQuestionRows,
  initialStatus = 'DRAFT',
  initialStep = 1,
  onStepChange,
  editing,
  editingClinicId,
}: {
  onExit: () => void;
  onSaved: (
    clinicId: string | undefined,
    clinic: ClinicDraft,
    hours: DayHours[],
    cutoffLeadHours: number,
    services: ServiceRow[],
    questions: QuestionRow[],
  ) => Promise<SavedClinicDraftState>;
  onApplied: () => Promise<void> | void;
  initialValue?: ClinicDraft;
  initialSchedule?: DayHours[];
  initialCutoffLeadHours?: number;
  initialServices?: ServiceRow[];
  initialQuestions?: QuestionRow[];
  initialStatus?: ClinicStatus;
  initialStep?: Step;
  onStepChange?: (step: Step) => void;
  editing?: boolean;
  editingClinicId?: string;
}) {
  const [step, setStepState] = useState<Step>(initialStep);
  const [completedSteps, setCompletedSteps] = useState<Step[]>(
    () => ([1, 2, 3, 4, 5] as Step[]).filter((item) => item < initialStep),
  );
  function setStep(nextStep: Step) {
    setStepState(nextStep);
    onStepChange?.(nextStep);
  }
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHeaderSlot(document.getElementById('clinic-setup-header-slot'));
  }, []);
  const [returnToReview, setReturnToReview] = useState(false);
  const [practiceLocationId, setPracticeLocationId] = useState(editingClinicId);
  const [draft, setDraft] = useState(initialValue ?? initialDraft);
  const [hours, setHours] = useState(initialSchedule ?? initialHours);
  const [cutoffLeadHours, setCutoffLeadHours] = useState(
    initialCutoffLeadHours ?? 2,
  );
  const [services, setServices] = useState(
    initialServiceRows ?? initialServices,
  );
  const [questions, setQuestions] = useState(
    initialQuestionRows ?? initialQuestions,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showActivateDialog, setShowActivateDialog] = useState(false);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const title =
    step === 1
      ? editing
        ? 'Edit Clinic'
        : 'Add New Clinic'
      : step === 2
        ? 'Clinic Hours (Required)'
        : step === 3
          ? 'Clinic Services'
          : step === 4
            ? 'Clinic Questions'
            : 'Review Your Clinic';

  function requiredFieldError() {
    const missing = [
      !draft.name.trim() ? 'Clinic Name' : '',
      !draft.address.trim() ? 'Address' : '',
      !draft.country ? 'Country' : '',
      !draft.timeZone ? 'Timezone' : '',
    ].filter(Boolean);
    return missing.length
      ? `Complete the required fields before continuing: ${missing.join(', ')}.`
      : '';
  }

  function scheduleInputError() {
    const invalidFormatRow = hours.find(
      (row) =>
        row.open &&
        (!isValidClock(row.opens) ||
          !isValidClock(row.closes) ||
          !isValidClock(row.maximumUntil)),
    );
    if (invalidFormatRow) {
      return `${invalidFormatRow.day} contains an invalid time. Use a time such as 08:07 AM.`;
    }
    const invalidRow = hours.find(
      (row) => row.open && parseClock(row.closes) <= parseClock(row.opens),
    );
    if (invalidRow) {
      return `${invalidRow.day} closing time must be later than its opening time.`;
    }
    const invalidMaximumRow = hours.find(
      (row) =>
        row.open && parseClock(row.maximumUntil) < parseClock(row.closes),
    );
    if (invalidMaximumRow) {
      return `${invalidMaximumRow.day} maximum operating time cannot be earlier than its closing time.`;
    }
    if (!hours.some((row) => row.open)) {
      return 'Select at least one open clinic day before continuing.';
    }
    return '';
  }

  async function persistDraft() {
    const saved = await onSaved(
      practiceLocationId,
      draft,
      hours,
      cutoffLeadHours,
      services,
      questions,
    );
    setPracticeLocationId(saved.id);
    setServices(saved.services);
    setQuestions(saved.questions);
    window.dispatchEvent(new Event('clinic-configuration-saved'));
    return saved.id;
  }

  async function saveDraftAndExit() {
    if (saving) return;
    setSaveError('');
    setSaving(true);
    try {
      await persistDraft();
      onExit();
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

  async function saveAndContinue() {
    if (saving) return;
    setSaveError('');
    const requiredError = requiredFieldError();
    if (step === 1 && requiredError) {
      setSaveError(requiredError);
      return;
    }
    const hoursError = scheduleInputError();
    if (hoursError) {
      setSaveError(hoursError);
      return;
    }

    setSaving(true);
    try {
      if (step === 2) {
        await apiRequest<{ valid: true }>(
          '/practice-location/schedule-preflight',
          {
            method: 'POST',
            body: {
              practiceLocationId,
              timeZone: draft.timeZone,
              schedules: hours.map((row) => ({
                weekday: weekdayFor(row.day),
                isOpen: row.open,
                opensAtLocal: row.open ? toApiLocalTime(row.opens) : undefined,
                closesAtLocal: row.open
                  ? toApiLocalTime(row.closes)
                  : undefined,
              })),
            },
          },
        );
      }
      await persistDraft();
      setCompletedSteps((completed) => completed.includes(step) ? completed : [...completed, step]);
      if (returnToReview) {
        setReturnToReview(false);
        setStep(5);
      } else {
        setStep(Math.min(5, step + 1) as Step);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save this clinic.';
      setSaveError(
        step === 2
          ? `Cannot continue with these clinic hours. ${message} Adjust the schedule so it does not overlap another active clinic.`
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveReviewDraft() {
    if (saving) return;
    setSaveError('');
    setSaving(true);
    try {
      await persistDraft();
      onExit();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Unable to save this clinic.',
      );
    } finally {
      setSaving(false);
    }
  }

  function editFromReview(targetStep: Step) {
    setSaveError('');
    setReturnToReview(true);
    setStep(targetStep);
  }

  function navigateToStep(targetStep: Step) {
    if (saving || targetStep === step) return;
    setSaveError('');
    setReturnToReview(false);
    setStep(targetStep);
  }

  function reviewPrimaryAction() {
    setSaveError('');
    if (initialStatus === 'DRAFT') {
      const hoursError = scheduleInputError();
      if (hoursError) {
        setSaveError(hoursError);
        return;
      }
      if (!practiceLocationId) {
        setSaveError('Save this clinic before activating it.');
        return;
      }
      setShowActivateDialog(true);
      return;
    }
    if (initialStatus === 'ACTIVE' || initialStatus === 'DISABLED') {
      if (!practiceLocationId) {
        setSaveError('Save this clinic before applying its configuration.');
        return;
      }
      setShowApplyDialog(true);
      return;
    }
    void saveReviewDraft();
  }

  const reviewPrimaryLabel =
    initialStatus === 'ACTIVE' || initialStatus === 'DISABLED'
      ? 'Apply Changes'
      : 'Activate Clinic';

  const primaryAction =
    step === 5
      ? reviewPrimaryAction
      : () => {
          void saveAndContinue();
        };

  return (
    <section className={`clinic-page clinic-setup-page${step === 2 ? ' clinic-hours-page' : ''}${step === 3 ? ' clinic-services-page' : ''}${step === 4 ? ' clinic-questions-page' : ''}`}>
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
              : returnToReview
                ? 'Make the change, then save and return directly to Review.'
                : 'Configure this clinic now or save it as a draft and continue later.'}
        </p>
      </div>
      {(step === 2 || step === 3 || step === 4) && headerSlot
        ? createPortal(<div className="clinic-hours-header-stepper"><Stepper step={step} completedSteps={completedSteps} onNavigate={navigateToStep} disabled={saving} /></div>, headerSlot)
        : <Stepper step={step} completedSteps={completedSteps} onNavigate={navigateToStep} disabled={saving} />}
      <div className={`clinic-setup-layout${step <= 4 ? ' has-guidance' : ''}`}>
      <div className="clinic-work-card">
        <div className="clinic-work-heading">
          <h2>{step === 1 ? 'Basic Information' : title}</h2>
          {step === 1 ? (
            <p>Provide the main details for this clinic.</p>
          ) : step === 2 ? (
            <p>Set the days and times this clinic operates.</p>
          ) : step === 3 ? (
            <p>Configure services offered at this clinic. Services are optional.</p>
          ) : step === 4 ? (
            <p>Configure questions patients answer when booking. Questions are optional.</p>
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
            onEdit={editFromReview}
          />
        ) : null}
        {saveError ? (
          <div className="form-error" role="alert">
            {saveError}
          </div>
        ) : null}
        <div className="clinic-footer-actions">
          {step === 1 && !returnToReview ? (
            <button className="clinic-secondary" type="button" onClick={onExit}>
              Cancel
            </button>
          ) : returnToReview ? (
            <button
              className="clinic-secondary"
              type="button"
              onClick={() => {
                setReturnToReview(false);
                setStep(5);
              }}
            >
              Back to Review
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
                ? reviewPrimaryLabel
                : returnToReview
                  ? 'Save and Return to Review'
                  : 'Save and Continue'
            }
            onPrimary={primaryAction}
            onDraft={() => {
              void saveDraftAndExit();
            }}
          />
        </div>
      </div>
      {step === 1 ? (
        <aside className="clinic-setup-guidance" aria-label="Clinic setup guidance">
          <section className="clinic-guide-card">
            <img className="clinic-guide-illustration" src={clinicIllustration} alt="Clinic illustration" />
            <h3>About Clinic Photos</h3>
            <p>Choose a clear photo that helps patients recognize your clinic.</p>
            <h4>Tips</h4>
            <ul><li>Use a clear, high-quality image</li><li>Show the clinic exterior or interior</li><li>Keep the file size under 5 MB</li><li>Supported formats: JPG, PNG</li></ul>
          </section>
          <section className="clinic-guide-card">

            <h3>About Clinics</h3>
            <p>A clinic represents a physical practice location where you provide services to patients.</p>
            <h4>Set up your clinic</h4>
            <ul><li>Clinic details and location</li><li>Clinic hours and schedules</li><li>Services offered</li><li>Booking questions</li><li>Review before activation</li></ul>
          </section>
          <section className="clinic-guide-card clinic-guide-note">
            <span aria-hidden="true">i</span>
            <div><h3>Save and continue later</h3><p>Choose Save as Draft from the save menu to keep your progress and finish setting up later.</p></div>
          </section>
        </aside>
      ) : null}
      </div>
      {showActivateDialog && practiceLocationId ? (
        <ActivateClinicDialog
          practiceLocationId={practiceLocationId}
          onCancel={() => setShowActivateDialog(false)}
          onActivated={async () => {
            setShowActivateDialog(false);
            await onApplied();
          }}
        />
      ) : null}
      {showApplyDialog && practiceLocationId ? (
        <ApplyClinicChangesDialog
          practiceLocationId={practiceLocationId}
          onCancel={() => setShowApplyDialog(false)}
          onApplied={async () => {
            setShowApplyDialog(false);
            await onApplied();
          }}
        />
      ) : null}
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
  'OPEN' | 'EDIT' | 'ACTIVATE' | 'ASSIGN_SECRETARY' | 'DISABLE' | 'DELETE';

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

function DirectoryIcon({ kind }: { kind: 'building' | 'location' | 'person' | 'search' }) {
  const paths = {
    building: <><path d="M4 21V6h10v15M14 10h6v11M2 21h20M8 9h2M8 13h2M8 17h2M17 13h1M17 17h1" /></>,
    location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    person: <><circle cx="12" cy="7" r="3" /><path d="M5 21v-2a7 7 0 0 1 14 0v2H5Z" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  };
  return <svg className="clinic-directory-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}

function ClinicDirectoryGuide({ onHide }: { onHide: () => void }) {
  return <aside className="clinic-directory-guide" aria-label="Clinic list guide">
    <section className="clinic-directory-guide-card">
      <button className="clinic-directory-hide" type="button" title="Hide panel" aria-label="Hide clinic guide" onClick={onHide}>«</button>
      <h2>About Clinics</h2><p>A clinic represents a practice location where patients can book appointments.</p>
      <div className="clinic-directory-guide-divider"><h3>Actions Menu</h3><p>Click the dropdown button (⌄) to manage each clinic. Select an action, then click the main button to continue.</p></div>
      <div className="clinic-directory-action-guide">
        {([
          ['activate', 'Open Clinic', "Manage the queue operation for this clinic (e.g., view today's queue, call next patient)."],
          ['edit', 'Edit Clinic', 'Update clinic configuration such as name, location, clinic hours, services, and booking questions.'],
          ['secretary', 'Assign Secretary', 'Assign or change the clinic secretary who can manage the clinic.'],
          ['disable', 'Disable Clinic', 'Temporarily close the clinic. Not visible to patients.'],
          ['delete', 'Delete Clinic', 'Permanently delete the clinic and its data, subject to deletion eligibility.'],
        ] as const).map(([kind, title, text]) => <div key={title} className={kind === 'delete' ? 'is-danger' : ''}><ClinicActionIcon kind={kind} /><div><h4>{title}</h4><p>{text}</p></div></div>)}
      </div>
    </section>
    <section className="clinic-directory-guide-card"><h2>ⓘ Clinic Status</h2><p>Each clinic can be in one of the following statuses:</p><div className="clinic-directory-status-guide">
      <span className="clinic-status-pill is-active">● Active</span><p>Patients can book appointments.</p>
      <span className="clinic-status-pill is-draft">● Draft</span><p>Setup not yet complete.<br />Not visible to patients.</p>
      <span className="clinic-status-pill is-disabled">● Disabled</span><p>Temporarily closed.<br />Not visible to patients.</p>
    </div></section>
    <section className="clinic-directory-guide-card"><h2>ⓘ Need Help?</h2><p>Learn more about managing your clinics.</p><details><summary>View Help Articles</summary><h4>Setting up a clinic</h4><p>Use Add New Clinic to enter clinic details, hours, services, and booking questions. Save your progress and review the clinic before activation.</p><h4>Managing an existing clinic</h4><p>Use the status tabs and search to find a clinic. Open its actions menu to edit its configuration or manage its availability.</p></details></section>
  </aside>;
}

function ClinicCardDetails({ clinic }: { clinic: ClinicRecord }) {
  const [overview, setOverview] = useState<ClinicOperationsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: clinic.timeZone || 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest<ClinicOperationsOverview>(`/practice-location/${encodeURIComponent(clinic.id)}/operations/overview?serviceDate=${date}`)
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch(() => { if (!cancelled) setOverview(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clinic.id, date]);
  const groups: { first: string; last: string; time: string }[] = [];
  const savedHours = clinic.savedHours?.length ? clinic.savedHours : overview?.recurringSchedules?.slice().sort((a, b) => ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].indexOf(a.weekday) - ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].indexOf(b.weekday)).map((row) => ({ day: row.weekday.charAt(0) + row.weekday.slice(1).toLowerCase(), open: row.isOpen, opens: fromApiLocalTime(row.opensAt, '--'), closes: fromApiLocalTime(row.closesAt, '--') })) ?? [];
  for (const day of savedHours) {
    const time = day.open ? `${day.opens} – ${day.closes}` : 'Closed';
    const previous = groups[groups.length - 1];
    if (previous?.time === time) previous.last = day.day;
    else groups.push({ first: day.day, last: day.day, time });
  }
  const today = overview?.schedule;
  const dayStatus = overview?.clinicDay?.status;
  const status = clinic.status !== 'ACTIVE' ? (clinic.status === 'DRAFT' ? 'Draft' : 'Disabled') : dayStatus === 'STARTED' ? 'Open' : dayStatus ? dayStatus.charAt(0) + dayStatus.slice(1).toLowerCase().replace(/_/g, ' ') : overview ? 'Not started' : loading ? 'Loading…' : 'Unavailable';
  return <>
    <div className="clinic-card-top">
      <div className="clinic-directory-identity">
        <div className="clinic-building-icon"><img src={clinic.clinicPhoto || clinicIllustration} alt={`${clinic.name || 'Clinic'} photo`} /></div>
        <div className="clinic-clinic-copy"><div className="clinic-card-title"><strong>{clinic.name.trim() || 'Untitled Clinic'}</strong><span className={`clinic-status-pill is-${clinic.status.toLowerCase()}`}>{clinic.status.charAt(0) + clinic.status.slice(1).toLowerCase()}</span></div><small aria-label="Clinic branch name">{clinic.shortCode.trim() ? clinic.shortCode.trim().replace(/[-_]+/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : '--'}</small>{overview?.clinic.doctorName ? <span className="clinic-card-doctor">{overview.clinic.doctorName}</span> : null}</div>
      </div>
      <div className="clinic-card-schedule"><h3><OperationsIcon name="calendar" />Clinic Schedule</h3>{groups.length ? groups.map((group) => <p key={group.first}><b>{group.first}{group.first !== group.last ? ` – ${group.last}` : ''}:</b> {group.time}</p>) : <p>Schedule not configured</p>}</div>
      <div className="clinic-card-contact"><div className="clinic-directory-location"><DirectoryIcon kind="location" /><span>{clinic.address || 'Address not entered'}</span></div><div className="clinic-secretary"><DirectoryIcon kind="person" /><span className={clinic.secretaryName ? 'clinic-secretary-name' : undefined}>{clinic.secretaryName || 'Not assigned'}</span></div><div><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 3h4l2 5-3 2c2 3 3 4 6 6l2-3 5 2v4c0 2-2 2-3 2C10 20 4 14 3 6c0-2 0-3 2-3Z"/></svg><span>{clinic.contactNumber || 'Contact number not entered'}</span></div></div>
    </div>
    <div className="clinic-card-today"><div><OperationsIcon name="clock" /><span>Today: {today ? today.isOpen ? `${fromApiLocalTime(today.opensAt, '--')} – ${fromApiLocalTime(today.closesAt, '--')}` : 'Closed' : loading ? 'Loading…' : 'Schedule unavailable'}</span></div><div className={dayStatus === 'STARTED' ? 'is-open' : ''}><span className="clinic-card-dot" />Clinic: {status}</div></div>
    <div className="clinic-card-patients"><OperationsIcon name="users" /><span>{overview ? `${overview.appointments.total} appointments today` : loading ? 'Loading…' : 'Patient count unavailable'}</span></div>
  </>;
}

export function ClinicList({
  clinics,
  onAdd,
  onOpen,
  onEdit,
  onActivate,
  onDisable,
  onDelete,
}: {
  clinics: ClinicRecord[];
  onAdd: () => void;
  onOpen: (clinic: ClinicRecord) => void;
  onEdit: (clinic: ClinicRecord) => void;
  onActivate: (clinic: ClinicRecord) => void;
  onDisable: (clinic: ClinicRecord) => void;
  onDelete: (clinic: ClinicRecord) => void;
}) {
  const [filter, setFilter] = useState<'ALL' | ClinicStatus>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showGuidance, setShowGuidance] = useState(true);
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
          [clinic.name, clinic.address, clinic.country, clinic.timeZone].join(' ').toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [clinics, filter, search],
  );

  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleClinics = filtered.slice(pageStart, pageStart + pageSize);

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
    if (action === 'OPEN') {
      onOpen(clinic);
      return;
    }
    if (action === 'EDIT') {
      onEdit(clinic);
      return;
    }
    if (action === 'ACTIVATE' && clinic.status === 'DRAFT') {
      onActivate(clinic);
      return;
    }
    if (action === 'DISABLE' && clinic.status === 'ACTIVE') {
      onDisable(clinic);
      return;
    }
    if (action === 'DELETE') {
      onDelete(clinic);
    }
  }

  return (
    <section className={`clinic-page clinic-directory${showGuidance ? ' has-directory-guide' : ''}`}><div className="clinic-directory-main">
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
      {!showGuidance && <button className="clinic-directory-show-guide" type="button" onClick={() => setShowGuidance(true)}>ⓘ Show clinic guide</button>}
      <div className="clinic-list-controls">
        <div className="clinic-tabs">
          {(['ALL', 'ACTIVE', 'DRAFT', 'DISABLED'] as const).map((value) => (
            <button
              className={filter === value ? 'is-active' : ''}
              type="button"
              onClick={() => { setFilter(value); setPage(1); setOpenActionMenuId(null); }}
              aria-pressed={filter === value}
              key={value}
            >
              {value === 'ALL'
                ? 'All'
                : value.charAt(0) + value.slice(1).toLowerCase()}{' '}
              <span>
                {value === 'ALL'
                  ? clinics.length
                  : clinics.filter((clinic) => clinic.status === value).length}
              </span>
            </button>
          ))}
        </div>
        <label className="clinic-directory-search"><DirectoryIcon kind="search" /><input
          aria-label="Search clinics" className="clinic-search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); setOpenActionMenuId(null); }}
          placeholder="Search clinics by name or location…"
        /></label>
      </div>
      <div className="clinic-table-card clinic-card-list">
        {filtered.length === 0 ? (
          <div className="clinic-empty">
            <div className="clinic-empty-icon">+</div>
            <h2>{clinics.length ? 'No matching clinics' : 'No clinics yet'}</h2>
            <p>{clinics.length ? 'Try another name, location, or status filter.' : 'Create your first clinic to begin configuration.'}</p>
            <button className="clinic-primary" type="button" onClick={onAdd}>
              Add New Clinic
            </button>
          </div>
        ) : (
          visibleClinics.map((clinic) => {
            const selectedAction = selectedActionFor(clinic);
            const selectedLabel = clinicListActionLabel(selectedAction);
            const executableNow =
              selectedAction === 'OPEN' ||
              selectedAction === 'EDIT' ||
              (selectedAction === 'ACTIVATE' && clinic.status === 'DRAFT') ||
              (selectedAction === 'DISABLE' && clinic.status === 'ACTIVE') ||
              selectedAction === 'DELETE';
            return (
              <article className="clinic-clinic-row" key={clinic.id}>
                <ClinicCardDetails clinic={clinic} />
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
                            action === 'EDIT' ||
                            (action === 'ACTIVATE' &&
                              clinic.status === 'DRAFT') ||
                            (action === 'DISABLE' &&
                              clinic.status === 'ACTIVE') ||
                            action === 'DELETE'
                              ? undefined
                              : 'Available in a later implementation phase.'
                          }
                          onClick={() => selectAction(clinic, action)}
                        >
                          <ClinicActionIcon
                            kind={clinicListActionIcon(action)}
                          />
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
        <div className="clinic-directory-pagination"><span>Showing {filtered.length ? pageStart + 1 : 0} to {Math.min(pageStart + pageSize, filtered.length)} of {filtered.length} clinics</span><div><button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); setOpenActionMenuId(null); }}>‹</button><span className="clinic-directory-current-page" aria-label={`Page ${currentPage} of ${pageCount}`}>{currentPage}</span><button type="button" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => { setPage(currentPage + 1); setOpenActionMenuId(null); }}>›</button></div></div>
      </div>
      </div>
      {showGuidance && <ClinicDirectoryGuide onHide={() => setShowGuidance(false)} />}
    </section>
  );
}

export function ClinicTabPage() {
  const navigate = useNavigate();
  const initialNavigation = readClinicEditNavigation();
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>(() =>
    initialNavigation.clinicId ? 'edit' : 'list',
  );
  const [requestedClinicId, setRequestedClinicId] = useState<string | null>(
    initialNavigation.clinicId,
  );
  const [requestedStep, setRequestedStep] = useState<Step>(
    initialNavigation.step,
  );
  const [clinicsLoaded, setClinicsLoaded] = useState(false);
  const [clinics, setClinics] = useState<ClinicRecord[]>([]);
  const [editingClinic, setEditingClinic] = useState<ClinicRecord | null>(null);
  const [activatingClinicId, setActivatingClinicId] = useState<string | null>(
    null,
  );
  const [disablingClinicId, setDisablingClinicId] = useState<string | null>(
    null,
  );
  const [deletingClinic, setDeletingClinic] = useState<ClinicRecord | null>(
    null,
  );
  const [loadError, setLoadError] = useState('');
  const [doctorDefaultTimeZone, setDoctorDefaultTimeZone] = useState(
    FALLBACK_TIME_ZONE,
  );
  const [doctorDefaultsLoaded, setDoctorDefaultsLoaded] = useState(false);

  async function loadClinics() {
    const locations =
      await apiRequest<PracticeLocationResponse[]>('/practice-location');
    const mapped = locations
      .map(toClinicRecord)
      .filter((clinic): clinic is ClinicRecord => clinic !== null);
    setClinics(mapped);
    setClinicsLoaded(true);
    return mapped;
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
        setClinicsLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : 'Unable to load clinics.',
        );
        setClinicsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<DoctorAccountSettingsResponse>('/doctor/account/settings')
      .then((settings) => {
        if (cancelled) return;
        setDoctorDefaultTimeZone(
          settings.defaultTimeZone?.trim() || FALLBACK_TIME_ZONE,
        );
      })
      .catch(() => {
        if (!cancelled) setDoctorDefaultTimeZone(FALLBACK_TIME_ZONE);
      })
      .finally(() => {
        if (!cancelled) setDoctorDefaultsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!clinicsLoaded || !requestedClinicId) return;
    const clinic = clinics.find(
      (candidate) => candidate.id === requestedClinicId,
    );
    if (clinic) {
      setEditingClinic(clinic);
      setMode('edit');
      return;
    }

    setRequestedClinicId(null);
    setRequestedStep(1);
    setEditingClinic(null);
    setMode('list');
    writeClinicEditNavigation(null);
    setLoadError('The clinic you were editing is no longer available.');
  }, [clinics, clinicsLoaded, requestedClinicId]);

  function returnToClinicList() {
    setRequestedClinicId(null);
    setRequestedStep(1);
    setEditingClinic(null);
    setMode('list');
    writeClinicEditNavigation(null);
  }

  async function applied() {
    try {
      await loadClinics();
      setLoadError('');
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Unable to reload clinics.',
      );
    }
    returnToClinicList();
  }

  async function saved(
    clinicId: string | undefined,
    clinic: ClinicDraft,
    hours: DayHours[],
    cutoffLeadHours: number,
    services: ServiceRow[],
    questions: QuestionRow[],
  ): Promise<SavedClinicDraftState> {
    if (!clinicId) {
      const created = await apiRequest<PracticeLocationResponse>(
        '/practice-location',
        {
          method: 'POST',
          body: {
            clinicPhoto: clinic.clinicPhoto,
            name: clinic.name.trim() || undefined,
            shortCode: formatClinicShortCode(clinic.shortCode) || undefined,
            addressLine1: clinic.address.trim() || undefined,
            contactNumber: clinic.contactNumber.trim() || undefined,
            clinicEmail: clinic.email.trim() || undefined,
            clinicDescription: clinic.description.trim() || undefined,
            countryCode:
              clinic.country === 'Philippines'
                ? 'PH'
                : clinic.country.slice(0, 2).toUpperCase(),
            timeZone: clinic.timeZone,
          },
        },
      );
      await loadClinics();
      return {
        id: created.id,
        services: servicesFromResponse(created.services, false),
        questions: questionsFromResponse(created.bookingQuestions, false),
      };
    }

    const savedConfiguration = await apiRequest<PracticeLocationResponse>(
      `/practice-location/${clinicId}/configuration-draft`,
      {
        method: 'PUT',
        body: {
          basicInfo: {
            clinicPhoto: clinic.clinicPhoto,
            name: clinic.name.trim() || undefined,
            shortCode: formatClinicShortCode(clinic.shortCode) || undefined,
            addressLine1: clinic.address.trim() || undefined,
            contactNumber: clinic.contactNumber.trim() || undefined,
            clinicEmail: clinic.email.trim() || undefined,
            clinicDescription: clinic.description.trim() || undefined,
            countryCode:
              clinic.country === 'Philippines'
                ? 'PH'
                : clinic.country.slice(0, 2).toUpperCase(),
            timeZone: clinic.timeZone,
          },
          schedules: hours.map((row) => ({
            weekday: weekdayFor(row.day),
            isOpen: row.open,
            opensAtLocal: row.open ? toApiLocalTime(row.opens) : undefined,
            closesAtLocal: row.open ? toApiLocalTime(row.closes) : undefined,
            maximumOnlineBookingUntilLocal: row.open
              ? toApiLocalTime(onlineCutoffFor(row, cutoffLeadHours))
              : undefined,
            maximumOperatingUntilLocal: row.open
              ? toApiLocalTime(row.maximumUntil)
              : undefined,
          })),
          services: services.map((service) => ({
            effectiveServiceId: service.effectiveServiceId,
            sourceDoctorServiceTemplateId:
              service.sourceDoctorServiceTemplateId,
            name: service.name,
            description: service.description || undefined,
            durationMinutes: service.minutes,
            status: service.active ? 'ACTIVE' : 'INACTIVE',
          })),
          bookingQuestions: questions.map((question) => ({
            effectiveBookingQuestionId: question.effectiveBookingQuestionId,
            sourceDoctorBookingQuestionTemplateId:
              question.sourceDoctorBookingQuestionTemplateId,
            questionText: question.question,
            type: question.type,
            isRequired: question.required,
            displayOrder: question.order,
            isActive: question.active,
            selectOptions:
              question.type === 'SINGLE_SELECT'
                ? (question.options ?? [])
                : undefined,
          })),
        },
      },
    );

    await loadClinics();
    const doctorDraft = savedConfiguration.doctorScheduleDraft;
    const wholeDraftSaved = Boolean(doctorDraft?.timeZone);
    return {
      id: clinicId,
      services:
        wholeDraftSaved && doctorDraft
          ? servicesFromResponse(doctorDraft.services, true)
          : servicesFromResponse(savedConfiguration.services, false),
      questions:
        wholeDraftSaved && doctorDraft
          ? questionsFromResponse(doctorDraft.bookingQuestions, true)
          : questionsFromResponse(savedConfiguration.bookingQuestions, false),
    };
  }

  if (mode === 'create' && !doctorDefaultsLoaded)
    return (
      <section className="clinic-page" aria-live="polite">
        <p>Loading clinic defaults…</p>
      </section>
    );
  if (mode === 'create')
    return (
      <ClinicWizard
        initialStatus="DRAFT"
        initialValue={{
          ...initialDraft,
          timeZone: doctorDefaultTimeZone || FALLBACK_TIME_ZONE,
        }}
        onExit={() => {
          setEditingClinic(null);
          setMode('list');
        }}
        onSaved={saved}
        onApplied={applied}
      />
    );
  if (mode === 'edit' && editingClinic)
    return (
      <ClinicWizard
        editing
        editingClinicId={editingClinic.id}
        initialStatus={editingClinic.status}
        initialStep={requestedStep}
        onStepChange={(nextStep) => {
          setRequestedStep(nextStep);
          writeClinicEditNavigation(editingClinic.id, nextStep);
        }}
        initialValue={editingClinic.editor.draft}
        initialSchedule={editingClinic.editor.hours}
        initialCutoffLeadHours={editingClinic.editor.cutoffLeadHours}
        initialServices={editingClinic.editor.services}
        initialQuestions={editingClinic.editor.questions}
        onExit={returnToClinicList}
        onSaved={saved}
        onApplied={applied}
      />
    );
  if (mode === 'edit' && requestedClinicId && !editingClinic) {
    return (
      <section className="clinic-page" aria-live="polite">
        <p>{clinicsLoaded ? 'Returning to clinics…' : 'Loading clinic…'}</p>
      </section>
    );
  }
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
          setRequestedClinicId(null);
          setRequestedStep(1);
          writeClinicEditNavigation(null);
          setEditingClinic(null);
          setMode('create');
        }}
        onOpen={(clinic) => {
          void navigate(
            `/app/clinics/${encodeURIComponent(clinic.id)}/operations`,
            {
              state: {
                clinic: {
                  name: clinic.name || 'North Clinic',
                  address: clinic.address,
                  timeZone: clinic.timeZone,
                },
              },
            },
          );
        }}
        onEdit={(clinic) => {
          setRequestedClinicId(clinic.id);
          setRequestedStep(1);
          writeClinicEditNavigation(clinic.id, 1);
          setEditingClinic(clinic);
          setMode('edit');
        }}
        onActivate={(clinic) => {
          setActivatingClinicId(clinic.id);
        }}
        onDisable={(clinic) => {
          setDisablingClinicId(clinic.id);
        }}
        onDelete={(clinic) => {
          setDeletingClinic(clinic);
        }}
      />
      {deletingClinic ? (
        <PermanentlyDeleteClinicDialog
          practiceLocationId={deletingClinic.id}
          clinicName={deletingClinic.name}
          onCancel={() => setDeletingClinic(null)}
          onDeleted={async () => {
            setDeletingClinic(null);
            try {
              await loadClinics();
              setLoadError('');
            } catch (error) {
              setLoadError(
                error instanceof Error
                  ? error.message
                  : 'Unable to reload clinics.',
              );
            }
          }}
        />
      ) : null}
      {disablingClinicId ? (
        <DisableClinicDialog
          practiceLocationId={disablingClinicId}
          onCancel={() => setDisablingClinicId(null)}
          onDisabled={async () => {
            setDisablingClinicId(null);
            try {
              await loadClinics();
              setLoadError('');
            } catch (error) {
              setLoadError(
                error instanceof Error
                  ? error.message
                  : 'Unable to reload clinics.',
              );
            }
          }}
        />
      ) : null}
      {activatingClinicId ? (
        <ActivateClinicDialog
          practiceLocationId={activatingClinicId}
          onCancel={() => setActivatingClinicId(null)}
          onActivated={async () => {
            setActivatingClinicId(null);
            try {
              await loadClinics();
              setLoadError('');
            } catch (error) {
              setLoadError(
                error instanceof Error
                  ? error.message
                  : 'Unable to reload clinics.',
              );
            }
          }}
        />
      ) : null}
    </>
  );
}

export function ClinicOperationsRoutePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clinicId } = useParams();
  const [serviceDate, setServiceDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [overview, setOverview] = useState<ClinicOperationsOverview | null>(
    null,
  );
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [queue, setQueue] = useState<ClinicOperationsQueue | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [operationsRevision, setOperationsRevision] = useState(0);
  const [bookingConfiguration, setBookingConfiguration] =
    useState<QueueDrawerBookingConfiguration | null>(null);
  const routeState = location.state as {
    clinic?: { name?: string; address?: string; timeZone?: string };
  } | null;
  const clinic = routeState?.clinic;

  useEffect(() => {
    if (!clinicId) return;
    void apiRequest<QueueDrawerBookingConfiguration>(
      `/booking/configuration/${encodeURIComponent(clinicId)}`,
    )
      .then(setBookingConfiguration)
      .catch(() => setBookingConfiguration(null));
  }, [clinicId]);

  useEffect(() => {
    let cancelled = false;
    if (!clinicId) {
      setOverviewError('Clinic identifier is missing.');
      setOverviewLoading(false);
      return;
    }
    setOverviewLoading(true);
    setOverviewError('');
    void apiRequest<ClinicOperationsOverview>(
      `/practice-location/${encodeURIComponent(clinicId)}/operations/overview?serviceDate=${encodeURIComponent(serviceDate)}`,
    )
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setOverview(null);
          setOverviewError(
            error instanceof Error
              ? error.message
              : 'Unable to load clinic operations.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, serviceDate, operationsRevision]);

  useEffect(() => {
    let cancelled = false;
    if (!clinicId) {
      setQueueError('Clinic identifier is missing.');
      setQueueLoading(false);
      return;
    }
    setQueueLoading(true);
    setQueueError('');
    void apiRequest<ClinicOperationsQueue>(
      `/practice-location/${encodeURIComponent(clinicId)}/operations/queue?serviceDate=${encodeURIComponent(serviceDate)}`,
    )
      .then((result) => {
        if (!cancelled) setQueue(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setQueue(null);
          setQueueError(
            error instanceof Error
              ? error.message
              : 'Unable to load the queue.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setQueueLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, serviceDate, operationsRevision]);

  async function handleOperationsEvent(event: ClinicOperationsEvent) {
    if (!clinicId) throw new Error('Clinic identifier is missing.');
    if (event.type === 'CALL_NEXT') {
      await apiRequest('/clinic-days/next-patient', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          practiceLocationId: clinicId,
          serviceDate,
          patientOutcome: event.patientOutcome,
        },
      });
    } else if (event.type === 'RETURN_TO_QUEUE') {
      await apiRequest('/clinic-days/staff-reinsert', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          practiceLocationId: clinicId,
          serviceDate,
          appointmentId: String(event.patientId),
        },
      });
    } else if (event.type === 'STAFF_REINSERT') {
      await apiRequest('/clinic-days/staff-reinsert', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          practiceLocationId: clinicId,
          serviceDate,
          appointmentId: String(event.patientId),
          ...(event.afterPatientId === undefined
            ? {}
            : { afterAppointmentId: String(event.afterPatientId) }),
        },
      });
    } else if (event.type === 'UNDO_QUEUE') {
      await apiRequest('/clinic-days/undo', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { practiceLocationId: clinicId, serviceDate },
      });
    } else if (event.type === 'ADD_WALK_IN') {
      await apiRequest('/booking/staff-appointment', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          practiceLocationId: clinicId,
          serviceDate,
          firstName: event.firstName,
          lastName: event.lastName,
          mobileNumber: event.mobileNumber,
          existingPatientResponse: event.existingPatientResponse,
          selectedServiceIds: event.selectedServiceIds,
          answers: event.answers,
        },
      });
    } else if (event.type === 'OPERATIONAL_NOTICE') {
      await apiRequest('/clinic-days/operational-notices/start', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          practiceLocationId: clinicId,
          serviceDate,
          kind: event.kind,
          reason: event.reason,
          message: event.message,
          expectedResumeAt: event.expectedResumeAt,
        },
      });
    } else {
      return;
    }
    setOperationsRevision((current) => current + 1);
  }

  async function loadAppointmentDetails(
    appointmentId: string | number,
  ): Promise<AppointmentDetailsModel> {
    if (!clinicId) throw new Error('Clinic identifier is missing.');
    const details = await apiRequest<{
      id: string;
      bookingReference: string;
      queueNumber: number;
      status: string;
      serviceDate: string;
      estimatedServiceMinutes: number;
      patientName: string;
      mobileNumber: string | null;
      source: 'ONLINE' | 'STAFF_ASSISTED';
      createdAt: string;
      calledAt: string | null;
      completedAt: string | null;
      cancelledAt: string | null;
      services: Array<{ id: string; name: string; durationMinutes: number }>;
      answers: Array<{
        questionId: string;
        question: string;
        answer: string | null;
      }>;
      history: Array<{
        id: string;
        type: string;
        occurredAt: string;
        actorName: string;
        actorRole: string;
      }>;
    }>(
      `/practice-location/${encodeURIComponent(clinicId)}/operations/appointments/${encodeURIComponent(String(appointmentId))}`,
    );
    return {
      id: details.id,
      queue: `#${String(details.queueNumber).padStart(2, '0')}`,
      name: details.patientName || 'Patient',
      reference: details.bookingReference,
      service:
        details.services.map((service) => service.name).join(', ') || '—',
      source: details.source === 'ONLINE' ? 'Online' : 'Staff-assisted',
      status:
        details.status === 'CALLED'
          ? 'NOW SERVING'
          : details.status.replaceAll('_', ' '),
      mobileNumber: details.mobileNumber,
      serviceDate: details.serviceDate,
      estimatedServiceMinutes: details.estimatedServiceMinutes,
      createdAt: details.createdAt,
      calledAt: details.calledAt,
      completedAt: details.completedAt,
      cancelledAt: details.cancelledAt,
      services: details.services,
      answers: details.answers,
      history: details.history,
    };
  }

  return (
    <ClinicOperationsWorkspace
      clinic={{
        name: clinic?.name || 'North Clinic',
        address: clinic?.address || 'Clinic address',
        timeZone: clinic?.timeZone || 'Asia/Manila',
      }}
      onBack={() => navigate('/app/clinics')}
      overview={overview}
      overviewLoading={overviewLoading}
      overviewError={overviewError}
      queue={queue}
      queueLoading={queueLoading}
      queueError={queueError}
      onEvent={handleOperationsEvent}
      onOverviewServiceDateChange={setServiceDate}
      bookingConfiguration={bookingConfiguration}
      loadAppointmentDetails={loadAppointmentDetails}
    />
  );
}
