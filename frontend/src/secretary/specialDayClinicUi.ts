function stepItem(number: number, label: string) {
  const item = document.createElement('div');
  item.className = 'special-wizard-step';
  item.innerHTML = `<span>${number}</span><strong>${label}</strong>`;
  return item;
}

function typeIcon(kind: 'open' | 'closed') {
  const icon = document.createElement('span');
  icon.className = `special-type-icon ${kind}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = kind === 'open'
    ? '<svg viewBox="0 0 24 24"><path d="M4 20h16M6 20V9l6-5 6 5v11M9 20v-6h6v6M9 10h.01M15 10h.01" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M6 3v3M18 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm4 7 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return icon;
}

function selectedIsOpen(form: HTMLFormElement) {
  const selected = form.querySelector<HTMLInputElement>('input[name="special-date-type"]:checked');
  return selected?.closest('label')?.textContent?.includes('Open') ?? true;
}

function applyStep(form: HTMLFormElement, step: 1 | 3 | 4) {
  form.dataset.specialStep = String(step);
  form.querySelectorAll<HTMLElement>('.special-wizard-step').forEach((item, index) => {
    const number = index + 1;
    const effectiveStep = step === 1 ? 2 : step;
    item.classList.toggle('active', number === effectiveStep || (step === 1 && number === 1));
    item.classList.toggle('complete', number < effectiveStep);
  });

  const grid = form.querySelector<HTMLElement>('.special-date-form-grid');
  const dateLabels = grid ? Array.from(grid.querySelectorAll<HTMLElement>(':scope > label')).slice(0, 2) : [];
  const type = grid?.querySelector<HTMLElement>('.special-date-type');
  const hours = grid?.querySelector<HTMLElement>('.special-date-hours');
  const sectionTitle = grid?.querySelector<HTMLElement>('.special-wizard-section-title');
  const review = form.querySelector<HTMLElement>('.special-wizard-review');
  const initial = step === 1;

  dateLabels.forEach((node) => { node.hidden = !initial; });
  if (type) type.hidden = !initial;
  if (sectionTitle) sectionTitle.hidden = !initial;
  if (hours) hours.hidden = step !== 3;
  if (review) review.hidden = step !== 4;

  const nav = form.querySelector<HTMLElement>('.special-wizard-nav');
  if (!nav) return;
  const back = nav.querySelector<HTMLButtonElement>('[data-special-back]');
  const next = nav.querySelector<HTMLButtonElement>('[data-special-next]');
  const save = nav.querySelector<HTMLButtonElement>('[data-special-save]');
  if (back) back.hidden = initial;
  if (next) next.hidden = step === 4;
  if (save) save.hidden = step !== 4;
}

function formatClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return value || '—';
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? 'pm' : 'am';
  const twelve = hour % 12 || 12;
  return `${String(twelve).padStart(2, '0')}:${match[2]} ${suffix}`;
}

function updateReview(form: HTMLFormElement) {
  const review = form.querySelector<HTMLElement>('.special-wizard-review');
  if (!review) return;
  const dates = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  const times = Array.from(form.querySelectorAll<HTMLInputElement>('.special-date-hours input[type="time"]'));
  const isOpen = selectedIsOpen(form);
  const start = dates[0]?.value || 'Not selected';
  const end = dates[1]?.value && dates[1].value !== dates[0]?.value ? dates[1].value : '';
  review.innerHTML = `
    <h4>Review special date</h4>
    <p>Check the proposed exception before adding it to this draft.</p>
    <dl>
      <div><dt>Date / range</dt><dd>${start}${end ? ` → ${end}` : ''}</dd></div>
      <div><dt>Type</dt><dd>${isOpen ? 'Open (special hours)' : 'Closed'}</dd></div>
      ${isOpen ? `<div><dt>Opening</dt><dd>${formatClock(times[0]?.value || '')}</dd></div><div><dt>Closing</dt><dd>${formatClock(times[1]?.value || '')}</dd></div><div><dt>Max operating until</dt><dd>${formatClock(times[2]?.value || '')}</dd></div>` : ''}
    </dl>`;
}

function validateInitial(form: HTMLFormElement) {
  const dates = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  const start = dates[0];
  const end = dates[1];
  if (!start?.value) { start?.reportValidity(); return false; }
  if (end?.value && end.value < start.value) { end.setCustomValidity('End date cannot be before the start date.'); end.reportValidity(); end.setCustomValidity(''); return false; }
  return true;
}

function validateRules(form: HTMLFormElement) {
  if (!selectedIsOpen(form)) return true;
  const times = Array.from(form.querySelectorAll<HTMLInputElement>('.special-date-hours input[type="time"]'));
  for (const input of times.slice(0, 2)) {
    if (!input.value) { input.reportValidity(); return false; }
  }
  return true;
}

function enhanceForm(form: HTMLFormElement) {
  if (form.dataset.specialEnhanced === 'true') return;
  form.dataset.specialEnhanced = 'true';

  const title = document.createElement('h3');
  title.className = 'special-wizard-title';
  title.textContent = 'Add special date';
  form.prepend(title);

  const stepper = document.createElement('div');
  stepper.className = 'special-wizard-stepper';
  stepper.append(stepItem(1, 'Date'), stepItem(2, 'Type'), stepItem(3, 'Rules (if open)'), stepItem(4, 'Review'));
  title.after(stepper);

  const grid = form.querySelector<HTMLElement>('.special-date-form-grid');
  if (grid) {
    const first = grid.querySelector<HTMLElement>(':scope > label');
    if (first) {
      const sectionTitle = document.createElement('h4');
      sectionTitle.className = 'special-wizard-section-title';
      sectionTitle.textContent = 'Select date or date range';
      grid.prepend(sectionTitle);
    }

    const type = grid.querySelector<HTMLElement>('.special-date-type');
    type?.querySelectorAll<HTMLLabelElement>('label').forEach((label) => {
      const copy = label.querySelector<HTMLElement>('span');
      if (!copy || label.querySelector('.special-type-icon')) return;
      const isOpen = label.textContent?.includes('Open') ?? false;
      label.insertBefore(typeIcon(isOpen ? 'open' : 'closed'), copy);
      const strong = label.querySelector('strong');
      const small = label.querySelector('small');
      if (strong) strong.textContent = isOpen ? 'Open (special hours)' : 'Closed';
      if (small) small.textContent = isOpen ? 'Clinic will be open with different hours.' : 'Clinic will be closed all day.';
    });
  }

  const review = document.createElement('section');
  review.className = 'special-wizard-review';
  review.hidden = true;
  form.querySelector('.special-date-form-grid')?.after(review);

  const originalActions = form.querySelector<HTMLElement>('.special-date-form-actions');
  if (originalActions) originalActions.hidden = true;

  const nav = document.createElement('div');
  nav.className = 'special-wizard-nav';
  nav.innerHTML = `
    <button class="secondary" type="button" data-special-back>← Back</button>
    <button class="primary" type="button" data-special-next>Next →</button>
    <button class="primary" type="button" data-special-save>Add special date</button>`;
  form.append(nav);

  nav.querySelector<HTMLButtonElement>('[data-special-back]')?.addEventListener('click', () => {
    const current = Number(form.dataset.specialStep || '1');
    applyStep(form, current === 4 && selectedIsOpen(form) ? 3 : 1);
  });

  nav.querySelector<HTMLButtonElement>('[data-special-next]')?.addEventListener('click', () => {
    const current = Number(form.dataset.specialStep || '1');
    if (current === 1) {
      if (!validateInitial(form)) return;
      if (selectedIsOpen(form)) applyStep(form, 3);
      else { updateReview(form); applyStep(form, 4); }
      return;
    }
    if (!validateRules(form)) return;
    updateReview(form);
    applyStep(form, 4);
  });

  nav.querySelector<HTMLButtonElement>('[data-special-save]')?.addEventListener('click', () => form.requestSubmit());
  applyStep(form, 1);
}

function enhanceHeader() {
  const page = document.querySelector<HTMLElement>('.secretary-proposal-page');
  const header = page?.querySelector<HTMLElement>('.secretary-proposal-header');
  if (!page || !header) return;
  const eyebrow = header.querySelector<HTMLElement>('.eyebrow');
  const heading = header.querySelector<HTMLElement>('h1');
  const badge = header.querySelector<HTMLElement>('.practice-status');
  if (!eyebrow || !heading) return;
  if (!page.dataset.clinicName && eyebrow.textContent?.trim() && eyebrow.textContent.trim().toLowerCase() !== 'clinic configuration') page.dataset.clinicName = eyebrow.textContent.trim();
  eyebrow.textContent = 'Clinic configuration';
  if (page.dataset.clinicName) heading.textContent = page.dataset.clinicName;
  if (badge?.textContent?.trim().toLowerCase() === 'draft') badge.classList.add('draft');
}

function enhanceEditor() {
  const editor = document.querySelector<HTMLElement>('.special-date-editor');
  if (!editor) return;
  const heading = editor.querySelector<HTMLElement>('.special-date-heading h2');
  if (heading) heading.textContent = 'Special day clinic';
  const description = editor.querySelector<HTMLElement>('.special-date-heading p');
  if (description) description.textContent = 'Manage dates with special hours or clinic closures. These dates override the regular weekly schedule.';
  const listTitle = editor.querySelector<HTMLElement>('.special-date-list-heading h3');
  if (listTitle) listTitle.textContent = 'Special dates list';
  const listHint = editor.querySelector<HTMLElement>('.special-date-list-heading p');
  if (listHint) listHint.hidden = true;
  const form = editor.querySelector<HTMLFormElement>('.special-date-form');
  if (form) enhanceForm(form);

  const head = editor.querySelector<HTMLElement>('.special-date-table-head');
  if (head && head.dataset.specialEnhanced !== 'true') {
    head.dataset.specialEnhanced = 'true';
    const headers = Array.from(head.children) as HTMLElement[];
    if (headers[0]) headers[0].textContent = 'Date / range';
  }
  editor.querySelectorAll<HTMLElement>('.special-date-table-row').forEach((row) => {
    const cells = Array.from(row.children) as HTMLElement[];
    if (cells[0]) cells[0].classList.add('special-date-cell-date');
    for (const index of [2, 3, 4]) if (cells[index]) cells[index].textContent = formatClock(cells[index].textContent || '');
    const badge = row.querySelector<HTMLElement>('.special-date-status');
    if (badge?.classList.contains('open')) badge.textContent = 'Open (special hours)';
  });
}

function refreshApprovedUi() {
  enhanceHeader();
  enhanceEditor();
}

export function installSpecialDayClinicUi() {
  const refresh = () => window.setTimeout(refreshApprovedUi, 0);
  document.addEventListener('click', refresh, true);
  document.addEventListener('change', refresh, true);
  refresh();
}
