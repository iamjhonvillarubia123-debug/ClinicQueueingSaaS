import { API_BASE_URL } from './api/client';

type Schedule = {
  isOpen?: boolean;
  opensAtLocal?: string | null;
  closesAtLocal?: string | null;
  maximumOperatingUntilLocal?: string | null;
  maximumOnlineBookingUntilLocal?: string | null;
};

type LocationRecord = {
  id: string;
  name?: string | null;
  addressLine1?: string | null;
  countryCode?: string | null;
  timeZone?: string | null;
  practiceSchedules?: Schedule[];
  services?: unknown[];
  bookingQuestions?: unknown[];
  doctorScheduleDraft?: {
    name?: string | null;
    addressLine1?: string | null;
    countryCode?: string | null;
    timeZone?: string | null;
    schedules?: Schedule[];
    services?: unknown[];
    bookingQuestions?: unknown[];
  } | null;
};

type GuidanceState = {
  basic: boolean;
  hours: boolean;
  services: boolean;
  questions: boolean;
  review: boolean;
};

const SETUP_ITEMS = [
  'Clinic details and location',
  'Clinic hours and schedules',
  'Services offered',
  'Booking questions',
  'Review before activation',
] as const;

const DETAILS: Record<(typeof SETUP_ITEMS)[number], [string, string]> = {
  'Clinic details and location': [
    'Basic information has been completed.',
    'Required clinic details are incomplete.',
  ],
  'Clinic hours and schedules': [
    'Clinic hours are configured.',
    'Not yet configured.',
  ],
  'Services offered': ['Services have been added.', 'Not yet configured.'],
  'Booking questions': [
    'Booking questions are configured.',
    'Not yet configured.',
  ],
  'Review before activation': [
    'Ready to review before activation.',
    'Complete required clinic details and hours.',
  ],
};

let lastClinicId = '';
let latestState: GuidanceState | null = null;
let refreshTimer: number | null = null;

function normalizeClock(value?: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function schedulesReady(schedules: Schedule[]) {
  return schedules.some((schedule) => {
    if (!schedule.isOpen) return false;
    const opens = normalizeClock(schedule.opensAtLocal);
    const closes = normalizeClock(schedule.closesAtLocal);
    const maximum = normalizeClock(
      schedule.maximumOperatingUntilLocal ??
        schedule.maximumOnlineBookingUntilLocal,
    );
    return (
      opens !== null &&
      closes !== null &&
      maximum !== null &&
      closes > opens &&
      maximum >= closes
    );
  });
}

function currentClinicId() {
  const url = new URL(window.location.href);
  if (url.pathname !== '/app/clinics') return '';
  if (url.searchParams.get('step') !== '1') return '';
  return url.searchParams.get('clinic') ?? '';
}

function findGuidanceCard(heading: string) {
  return [...document.querySelectorAll<HTMLElement>('.clinic-guide-card')].find(
    (card) => card.querySelector('h3')?.textContent?.trim() === heading,
  );
}

function statusMarkup(complete: boolean) {
  const icon = complete ? '✓' : '×';
  return `<span class="clinic-guidance-status-icon ${complete ? 'is-complete' : 'is-incomplete'}" aria-hidden="true">${icon}</span>`;
}

function decoratePhotoTips() {
  const card = findGuidanceCard('About Clinic Photos');
  if (!card) return;
  const hasSelectedPhoto = Boolean(
    document.querySelector('img[alt="Selected clinic photo preview"]'),
  );
  const items = [...card.querySelectorAll<HTMLLIElement>('li')];
  for (const item of items) {
    const text = item.textContent?.trim() ?? '';
    item.classList.add('clinic-guidance-status-row');
    item.classList.toggle('is-complete', hasSelectedPhoto);
    item.classList.toggle('is-incomplete', !hasSelectedPhoto);
    const existing = item.querySelector('.clinic-guidance-status-icon');
    if (existing) existing.remove();
    item.insertAdjacentHTML('afterbegin', statusMarkup(hasSelectedPhoto));
    const label = document.createElement('span');
    label.className = 'clinic-guidance-status-label';
    label.textContent = text;
    for (const node of [...item.childNodes]) {
      if (node !== item.firstChild) node.remove();
    }
    item.append(label);
  }
}

function decorateSetup(state: GuidanceState) {
  const card = findGuidanceCard('About Clinics');
  if (!card) return;
  const list = card.querySelector('ul');
  if (!list) return;

  const stateByLabel: Record<(typeof SETUP_ITEMS)[number], boolean> = {
    'Clinic details and location': state.basic,
    'Clinic hours and schedules': state.hours,
    'Services offered': state.services,
    'Booking questions': state.questions,
    'Review before activation': state.review,
  };

  for (const item of [...list.querySelectorAll<HTMLLIElement>('li')]) {
    const label = SETUP_ITEMS.find((name) => item.textContent?.includes(name));
    if (!label) continue;
    const complete = stateByLabel[label];
    item.className = `clinic-guidance-status-row ${complete ? 'is-complete' : 'is-incomplete'}`;
    item.innerHTML = `${statusMarkup(complete)}<span class="clinic-guidance-status-copy"><span class="clinic-guidance-status-label">${label}</span><small>${complete ? DETAILS[label][0] : DETAILS[label][1]}</small></span>`;
  }
}

function visibleBasicInformationComplete(serverBasic: boolean) {
  const labels = [...document.querySelectorAll<HTMLLabelElement>('.clinic-basic-layout > label')];
  const valueFor = (caption: string) => {
    const label = labels.find((candidate) =>
      candidate.textContent?.trim().startsWith(caption),
    );
    if (!label) return '';
    const control = label.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input, textarea, select',
    );
    if (control) return control.value.trim();
    const picker = label.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
    return picker?.textContent?.trim() ?? '';
  };

  const hasVisibleBasicForm = labels.length > 0;
  if (!hasVisibleBasicForm) return serverBasic;
  return Boolean(
    valueFor('Clinic Name') &&
      valueFor('Address') &&
      valueFor('Country') &&
      valueFor('Timezone'),
  );
}

async function fetchState(clinicId: string): Promise<GuidanceState | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/practice-location`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const locations = (await response.json()) as LocationRecord[];
    const location = locations.find((item) => item.id === clinicId);
    if (!location) return null;

    const draft = location.doctorScheduleDraft;
    const basic = Boolean(
      (draft?.name ?? location.name)?.trim() &&
        (draft?.addressLine1 ?? location.addressLine1)?.trim() &&
        (draft?.countryCode ?? location.countryCode)?.trim() &&
        (draft?.timeZone ?? location.timeZone)?.trim(),
    );
    const schedules = draft?.schedules ?? location.practiceSchedules ?? [];
    const services = draft?.services ?? location.services ?? [];
    const questions = draft?.bookingQuestions ?? location.bookingQuestions ?? [];
    const hours = schedulesReady(schedules);

    return {
      basic,
      hours,
      services: services.length > 0,
      questions: questions.length > 0,
      review: basic && hours,
    };
  } catch {
    return null;
  }
}

function applyLatestState() {
  decoratePhotoTips();
  if (!latestState) return;
  decorateSetup({
    ...latestState,
    basic: visibleBasicInformationComplete(latestState.basic),
  });
}

function scheduleRefresh() {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, 180);
}

async function refresh() {
  const clinicId = currentClinicId();
  if (!clinicId) {
    lastClinicId = '';
    latestState = null;
    return;
  }

  if (clinicId !== lastClinicId || !latestState) {
    lastClinicId = clinicId;
    latestState = await fetchState(clinicId);
  }
  applyLatestState();
}

const observer = new MutationObserver(() => {
  scheduleRefresh();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src'],
});

document.addEventListener('input', scheduleRefresh, true);
document.addEventListener('change', scheduleRefresh, true);
window.addEventListener('popstate', scheduleRefresh);

window.setInterval(() => {
  if (!currentClinicId()) return;
  latestState = null;
  scheduleRefresh();
}, 5000);

scheduleRefresh();
