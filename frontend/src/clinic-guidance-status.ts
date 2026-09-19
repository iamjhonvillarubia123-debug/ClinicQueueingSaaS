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

type ClinicSetupStep = 1 | 2 | 3 | 4 | 5;

type ClinicSetupContext = {
  clinicId: string;
  step: ClinicSetupStep;
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
  'Services offered': [
    'Services have been added.',
    'Optional — none added.',
  ],
  'Booking questions': [
    'Booking questions are configured.',
    'Optional — none added.',
  ],
  'Review before activation': [
    'Ready to review before activation.',
    'Complete all required steps.',
  ],
};

const STEP_GUIDANCE: Record<
  Exclude<ClinicSetupStep, 1>,
  { heading: string; body: string; tips: string[] }
> = {
  2: {
    heading: 'About Clinic Hours',
    body: 'Set when this clinic operates and when patients can book.',
    tips: [],
  },
  3: {
    heading: 'About Clinic Services',
    body: 'Add the services patients can choose when booking at this clinic.',
    tips: [
      'Services are optional for activation.',
      'Use clear patient-facing service names.',
      'Set an expected duration for each service.',
      'You can add or change services later.',
    ],
  },
  4: {
    heading: 'About Clinic Questions',
    body: 'Collect information that is useful before the patient arrives.',
    tips: [
      'Booking questions are optional for activation.',
      'Only ask for information needed for the visit.',
      'Mark a question required only when necessary.',
      'You can add or change questions later.',
    ],
  },
  5: {
    heading: 'Before Activation',
    body: 'Review the clinic configuration before making it available for use.',
    tips: [
      'Confirm the clinic identity and location',
      'Confirm at least one valid clinic-hours schedule',
      'Services and booking questions may remain optional',
      'Return to any section if something needs correction',
    ],
  },
};

let requestVersion = 0;
let lastClinicId = '';
let latestState: GuidanceState | null = null;
let refreshTimer: number | null = null;
let observerStarted = false;

function normalizeClock(value?: string | null) {
  if (!value) return null;
  const match = value.match(/(?:^|T)(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function schedulesReady(schedules: Schedule[]) {
  const openDays = schedules.filter((schedule) => schedule.isOpen);
  return openDays.length > 0 && openDays.every((schedule) => {
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

function currentClinicContext(): ClinicSetupContext | null {
  const url = new URL(window.location.href);
  if (url.pathname !== '/app/clinics') return null;
  const clinicId = url.searchParams.get('clinic') ?? '';
  const candidateStep = Number(url.searchParams.get('step'));
  if (!clinicId || candidateStep < 1 || candidateStep > 5) return null;
  return { clinicId, step: candidateStep as ClinicSetupStep };
}

function currentClinicId() {
  return currentClinicContext()?.clinicId ?? '';
}

function findGuidanceCard(heading: string) {
  return [...document.querySelectorAll<HTMLElement>('.clinic-guide-card')].find(
    (card) => card.querySelector('h3')?.textContent?.trim() === heading,
  );
}

function guidanceStatusListMarkup() {
  return SETUP_ITEMS.map((item) => `<li>${item}</li>`).join('');
}

function clinicHoursGuidanceMarkup() {
  return `
    <div class="clinic-hours-guide-section">
      <span class="clinic-hours-guide-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 5v7l5 3"/></svg></span>
      <div>
        <h4>Clinic schedule</h4>
        <ul>
          <li>Turn on <strong>Open</strong> for the days this clinic operates.</li>
          <li>Set the opening and closing times.</li>
          <li>Set a Maximum Operating Time if the clinic or queue may continue after closing (cannot be earlier than closing time).</li>
        </ul>
      </div>
    </div>
    <div class="clinic-hours-guide-section">
      <span class="clinic-hours-guide-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M7 1v6M17 1v6M7 13h2m3 0h2M7 17h2m3 0h2"/></svg></span>
      <div>
        <h4>Online booking</h4>
        <ul>
          <li>Online booking cutoff is automatically calculated from the closing time and the cutoff setting below.</li>
          <li>You cannot edit the cutoff time in the table.</li>
        </ul>
      </div>
    </div>
    <div class="clinic-hours-guide-section">
      <span class="clinic-hours-guide-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8M8 16h8"/></svg></span>
      <div>
        <h4>Tips</h4>
        <ul>
          <li>You can copy a day's schedule to other days.</li>
          <li>You can select from the list or enter an exact time (e.g. 08:07 AM).</li>
          <li>At least one clinic day must be open before activation.</li>
          <li>The system checks for schedule conflicts before saving.</li>
        </ul>
      </div>
    </div>
  `;
}

export function ensureGuidancePanel() {
  const context = currentClinicContext();
  if (!context) return;

  const layout = document.querySelector<HTMLElement>('.clinic-setup-layout');
  if (!layout) return;
  layout.classList.add('has-guidance');

  // Only replace panels owned by this helper; Basic Information owns its
  // guidance in React and must retain that panel when navigating back.
  const generatedPanel = layout.querySelector<HTMLElement>(
    '.clinic-setup-guidance[data-journey-guidance="true"]',
  );
  if (generatedPanel?.dataset.guidanceStep !== String(context.step)) {
    generatedPanel?.remove();
  }
  if (layout.querySelector('.clinic-setup-guidance')) return;
  if (context.step === 1) return;

  const guidance = STEP_GUIDANCE[context.step];
  const aside = document.createElement('aside');
  aside.className = 'clinic-setup-guidance';
  aside.setAttribute('aria-label', 'Clinic setup guidance');
  aside.dataset.journeyGuidance = 'true';
  aside.dataset.guidanceStep = String(context.step);
  const contextDetails =
    context.step === 2
      ? clinicHoursGuidanceMarkup()
      : `<div class="${context.step === 3 || context.step === 4 ? 'clinic-services-tips' : ''}">${context.step === 3 || context.step === 4 ? '<svg class="clinic-services-tips-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8M8 16h8"/></svg>' : ''}<h4>Tips</h4><ul>${guidance.tips
          .map((tip) => `<li>${tip}</li>`)
          .join('')}</ul></div>${context.step === 3 ? '<div class="clinic-services-duration-note"><span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/></svg></span><div><h4>Service duration and queue</h4><p>The service duration determines the estimated time for each patient in the queue.<br>A longer duration will allocate more time per patient and may reduce the number of available queue slots for the same clinic hours.</p></div></div>' : ''}`;
  aside.innerHTML = `
    <section class="clinic-guide-card clinic-journey-context-card${context.step === 2 ? ' clinic-hours-guide-card' : ''}">
      <h3>${guidance.heading}</h3>
      <p>${guidance.body}</p>
      ${contextDetails}
    </section>
    <section class="clinic-guide-card">
      <h3>${context.step === 2 || context.step === 3 || context.step === 4 ? 'Set up your clinic' : 'About Clinics'}</h3>
      <p>Complete the following to prepare your clinic for activation.</p>
      ${context.step === 2 || context.step === 3 || context.step === 4 ? '' : '<h4>Set up your clinic</h4>'}
      <ul>${guidanceStatusListMarkup()}</ul>
    </section>
    <section class="clinic-guide-card clinic-guide-note">
      <span aria-hidden="true">i</span>
      <div>
        <h3>Save and continue later</h3>
        <p>Choose Save as Draft from the save menu to keep your progress and finish setting up later.</p>
      </div>
    </section>
  `;
  layout.appendChild(aside);
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
    const originalLabel =
      item.dataset.guidanceLabel ?? item.textContent?.trim() ?? '';
    item.dataset.guidanceLabel = originalLabel;
    item.className = `clinic-guidance-status-row ${hasSelectedPhoto ? 'is-complete' : 'is-incomplete'}`;
    item.innerHTML = `${statusMarkup(hasSelectedPhoto)}<span class="clinic-guidance-status-label">${originalLabel}</span>`;
  }
}

function decorateSetup(state: GuidanceState) {
  const card = findGuidanceCard('Set up your clinic') ?? findGuidanceCard('About Clinics');
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
    const storedLabel = item.dataset.guidanceLabel;
    const label =
      (storedLabel as (typeof SETUP_ITEMS)[number] | undefined) ??
      SETUP_ITEMS.find((name) => item.textContent?.includes(name));
    if (!label || !SETUP_ITEMS.includes(label)) continue;
    item.dataset.guidanceLabel = label;
    const complete = stateByLabel[label];
    item.className = `clinic-guidance-status-row ${complete ? 'is-complete' : 'is-incomplete'}`;
    item.innerHTML = `${statusMarkup(complete)}<span class="clinic-guidance-status-copy"><span class="clinic-guidance-status-label">${label}</span><small>${complete ? DETAILS[label][0] : DETAILS[label][1]}</small></span>`;
  }
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

function startObserver() {
  if (observerStarted) observer.disconnect();
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  observerStarted = true;
}

function applyLatestState() {
  observer.disconnect();
  try {
    ensureGuidancePanel();
    decoratePhotoTips();
    if (!latestState) return;
    decorateSetup(latestState);
  } finally {
    startObserver();
  }
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
    const version = ++requestVersion;
    const state = await fetchState(clinicId);
    if (version !== requestVersion || currentClinicId() !== clinicId) return;
    latestState = state;
  }
  applyLatestState();
}

const observer = new MutationObserver(() => {
  if (!currentClinicId()) {
    lastClinicId = '';
    latestState = null;
  }
  scheduleRefresh();
});

startObserver();
document.addEventListener('input', scheduleRefresh, true);
document.addEventListener('change', scheduleRefresh, true);
window.addEventListener('popstate', scheduleRefresh);
window.addEventListener('clinic-configuration-saved', () => {
  requestVersion += 1;
  latestState = null;
  scheduleRefresh();
});

scheduleRefresh();
