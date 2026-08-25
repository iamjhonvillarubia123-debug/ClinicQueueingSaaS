const sectionByLabel: Record<string, string> = {
  'Clinic details': 'clinic',
  'Services & questions': 'content',
  'Clinic schedules': 'schedules',
  'Special dates': 'special',
};

const labelBySection: Record<string, string> = Object.fromEntries(
  Object.entries(sectionByLabel).map(([label, section]) => [section, label]),
);

function isSettingsDraftRoute() {
  return /^\/app\/secretary\/settings-drafts\/[^/]+$/.test(window.location.pathname);
}

function requestedSection() {
  if (!isSettingsDraftRoute()) return null;
  const value = new URLSearchParams(window.location.search).get('tab');
  return value && labelBySection[value] ? value : null;
}

function writeSection(section: string) {
  const url = new URL(window.location.href);
  if (section === 'clinic') url.searchParams.delete('tab');
  else url.searchParams.set('tab', section);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function findTab(label: string) {
  const nav = document.querySelector<HTMLElement>('.secretary-proposal-nav');
  if (!nav) return null;
  return Array.from(nav.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === label,
  ) ?? null;
}

function restoreRequestedSection() {
  const section = requestedSection();
  if (!section || section === 'clinic') return;
  const label = labelBySection[section];

  let frames = 0;
  const tryRestore = () => {
    if (!isSettingsDraftRoute()) return;
    const button = findTab(label);
    if (button) {
      if (!button.classList.contains('active')) button.click();
      return;
    }
    frames += 1;
    if (frames < 90) window.requestAnimationFrame(tryRestore);
  };
  window.requestAnimationFrame(tryRestore);
}

export function installClinicConfigurationTabPersistence() {
  document.addEventListener('click', (event) => {
    if (!isSettingsDraftRoute()) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.secretary-proposal-nav button') : null;
    if (!target) return;
    const label = target.textContent?.trim() ?? '';
    const section = sectionByLabel[label];
    if (section) writeSection(section);
  });

  window.addEventListener('popstate', () => restoreRequestedSection());
  restoreRequestedSection();
}
