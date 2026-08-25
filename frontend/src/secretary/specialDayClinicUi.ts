type WizardStep = 1 | 2 | 3 | 4;

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

function actionIcon(kind: 'edit' | 'delete') {
  return kind === 'edit'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10-10-3.2-3.2-10 10L4 20Zm9.7-12.9 3.2 3.2M14.7 6l1.6-1.6a1.4 1.4 0 0 1 2 0l1.3 1.3a1.4 1.4 0 0 1 0 2L18 9.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7m4-7v7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function selectedIsOpen(form: HTMLFormElement) {
  const selected = form.querySelector<HTMLInputElement>('input[name="special-date-type"]:checked');
  return selected?.closest('label')?.textContent?.includes('Open') ?? true;
}

function formatClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return value || '—';
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? 'pm' : 'am';
  const twelve = hour % 12 || 12;
  return `${String(twelve).padStart(2, '0')}:${match[2]} ${suffix}`;
}

function formatUsDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

function currentDraftId() {
  return /\/settings-drafts\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? 'draft';
}

function noteKey(serviceDate: string) {
  return `clinic-special-note:${currentDraftId()}:${serviceDate}`;
}

function hiddenKey(serviceDate: string) {
  return `clinic-special-hidden:${currentDraftId()}:${serviceDate}`;
}

function datesInclusive(startValue: string, endValue: string) {
  if (!startValue) return [];
  const start = new Date(`${startValue}T00:00:00Z`);
  const end = new Date(`${endValue || startValue}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end && dates.length <= 366; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function getNote(form: HTMLFormElement) {
  return form.querySelector<HTMLTextAreaElement>('[data-special-note]')?.value.trim() ?? '';
}

function applyStep(form: HTMLFormElement, step: WizardStep) {
  form.dataset.specialStep = String(step);
  form.querySelectorAll<HTMLElement>('.special-wizard-step').forEach((item, index) => {
    const number = index + 1;
    item.classList.toggle('active', number === step);
    item.classList.toggle('complete', number < step);
  });

  const grid = form.querySelector<HTMLElement>('.special-date-form-grid');
  const dateLabels = grid ? Array.from(grid.querySelectorAll<HTMLElement>(':scope > label')).filter((label) => !label.classList.contains('special-note-field')).slice(0, 2) : [];
  const type = grid?.querySelector<HTMLElement>('.special-date-type');
  const note = grid?.querySelector<HTMLElement>('.special-note-field');
  const hours = grid?.querySelector<HTMLElement>('.special-date-hours');
  const sectionTitle = grid?.querySelector<HTMLElement>('.special-wizard-section-title');
  const dateHint = grid?.querySelector<HTMLElement>('.special-date-format-hint');
  const review = form.querySelector<HTMLElement>('.special-wizard-review');

  dateLabels.forEach((node) => { node.hidden = step !== 1; });
  if (sectionTitle) sectionTitle.hidden = step !== 1;
  if (dateHint) dateHint.hidden = step !== 1;
  if (type) type.hidden = step !== 2;
  if (note) note.hidden = step !== 2;
  if (hours) hours.hidden = step !== 3;
  if (review) review.hidden = step !== 4;

  const nav = form.querySelector<HTMLElement>('.special-wizard-nav');
  if (!nav) return;
  const back = nav.querySelector<HTMLButtonElement>('[data-special-back]');
  const next = nav.querySelector<HTMLButtonElement>('[data-special-next]');
  const save = nav.querySelector<HTMLButtonElement>('[data-special-save]');
  if (back) back.hidden = step === 1;
  if (next) next.hidden = step === 4;
  if (save) save.hidden = step !== 4;
}

function updateReview(form: HTMLFormElement) {
  const review = form.querySelector<HTMLElement>('.special-wizard-review');
  if (!review) return;
  const dates = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  const times = Array.from(form.querySelectorAll<HTMLInputElement>('.special-date-hours input[type="time"]'));
  const isOpen = selectedIsOpen(form);
  const start = dates[0]?.value ? formatUsDate(dates[0].value) : 'Not selected';
  const end = dates[1]?.value && dates[1].value !== dates[0]?.value ? formatUsDate(dates[1].value) : '';
  const note = getNote(form) || '—';
  review.innerHTML = `
    <h4>Review special date</h4>
    <p>Check the proposed exception before adding it to this draft.</p>
    <dl>
      <div><dt>Date / range</dt><dd>${start}${end ? ` → ${end}` : ''}</dd></div>
      <div><dt>Type</dt><dd>${isOpen ? 'Open (special hours)' : 'Closed'}</dd></div>
      <div><dt>Reason / notes</dt><dd>${note}</dd></div>
      ${isOpen ? `<div><dt>Opening</dt><dd>${formatClock(times[0]?.value || '')}</dd></div><div><dt>Closing</dt><dd>${formatClock(times[1]?.value || '')}</dd></div><div><dt>Max operating until</dt><dd>${formatClock(times[2]?.value || '')}</dd></div>` : ''}
    </dl>`;
}

function validateDates(form: HTMLFormElement) {
  const dates = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  const start = dates[0];
  const end = dates[1];
  if (!start?.value) { start?.reportValidity(); return false; }
  if (end?.value && end.value < start.value) {
    end.setCustomValidity('End date cannot be before the start date.');
    end.reportValidity();
    end.setCustomValidity('');
    return false;
  }
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

function persistPrototypeNotes(form: HTMLFormElement) {
  const dates = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  const note = getNote(form);
  for (const serviceDate of datesInclusive(dates[0]?.value ?? '', dates[1]?.value || dates[0]?.value || '')) {
    if (note) sessionStorage.setItem(noteKey(serviceDate), note);
    else sessionStorage.removeItem(noteKey(serviceDate));
    sessionStorage.removeItem(hiddenKey(serviceDate));
  }
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
      const hint = document.createElement('p');
      hint.className = 'special-date-format-hint';
      hint.textContent = 'Date format: MM/DD/YYYY';
      sectionTitle.after(hint);
    }

    grid.querySelectorAll<HTMLInputElement>('input[type="date"]').forEach((input) => {
      input.lang = 'en-US';
      input.setAttribute('aria-description', 'Date format: MM/DD/YYYY');
    });

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

    if (type && !grid.querySelector('.special-note-field')) {
      const note = document.createElement('label');
      note.className = 'special-note-field';
      note.innerHTML = 'Reason / notes <span class="optional">Optional</span><textarea data-special-note maxlength="250" rows="3" placeholder="e.g., National holiday, medical mission, maintenance"></textarea><small>For clinic staff and Doctor review.</small>';
      type.after(note);
    }
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
    const current = Number(form.dataset.specialStep || '1') as WizardStep;
    if (current === 2) applyStep(form, 1);
    else if (current === 3) applyStep(form, 2);
    else if (current === 4) applyStep(form, selectedIsOpen(form) ? 3 : 2);
  });

  nav.querySelector<HTMLButtonElement>('[data-special-next]')?.addEventListener('click', () => {
    const current = Number(form.dataset.specialStep || '1') as WizardStep;
    if (current === 1) {
      if (validateDates(form)) applyStep(form, 2);
      return;
    }
    if (current === 2) {
      if (selectedIsOpen(form)) applyStep(form, 3);
      else { updateReview(form); applyStep(form, 4); }
      return;
    }
    if (current === 3) {
      if (!validateRules(form)) return;
      updateReview(form);
      applyStep(form, 4);
    }
  });

  nav.querySelector<HTMLButtonElement>('[data-special-save]')?.addEventListener('click', () => {
    persistPrototypeNotes(form);
    form.requestSubmit();
  });
  applyStep(form, 1);
}

function openEditorForRow(row: HTMLElement) {
  const editor = document.querySelector<HTMLElement>('.special-date-editor');
  if (!editor) return;
  let form = editor.querySelector<HTMLFormElement>('.special-date-form');
  if (!form) {
    const toggle = editor.querySelector<HTMLButtonElement>('.special-date-heading .primary');
    toggle?.click();
    window.setTimeout(() => {
      form = editor.querySelector<HTMLFormElement>('.special-date-form');
      if (form) populateEditor(form, row);
    }, 0);
    return;
  }
  populateEditor(form, row);
}

function populateEditor(form: HTMLFormElement, row: HTMLElement) {
  enhanceForm(form);
  const date = row.dataset.serviceDate ?? '';
  const dateInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  if (dateInputs[0]) dateInputs[0].value = date;
  if (dateInputs[1]) dateInputs[1].value = date;

  const isOpen = row.dataset.isOpen === 'true';
  const radios = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="special-date-type"]'));
  const targetRadio = radios.find((radio) => (radio.closest('label')?.textContent?.includes('Open') ?? false) === isOpen);
  if (targetRadio) {
    targetRadio.checked = true;
    targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const times = Array.from(form.querySelectorAll<HTMLInputElement>('.special-date-hours input[type="time"]'));
  if (times[0]) times[0].value = row.dataset.opening ?? '';
  if (times[1]) times[1].value = row.dataset.closing ?? '';
  if (times[2]) times[2].value = row.dataset.maxOperating ?? '';
  const note = form.querySelector<HTMLTextAreaElement>('[data-special-note]');
  if (note) note.value = sessionStorage.getItem(noteKey(date)) ?? '';
  applyStep(form, 1);
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const notes = document.createElement('span');
    notes.textContent = 'Notes';
    const actions = document.createElement('span');
    actions.textContent = 'Actions';
    head.append(notes, actions);
  }

  editor.querySelectorAll<HTMLElement>('.special-date-table-row').forEach((row) => {
    const cells = Array.from(row.children) as HTMLElement[];
    if (!row.dataset.serviceDate) row.dataset.serviceDate = cells[0]?.textContent?.trim() ?? '';
    const serviceDate = row.dataset.serviceDate;
    if (!serviceDate) return;
    if (!row.dataset.opening) row.dataset.opening = cells[2]?.textContent?.trim() === '—' ? '' : cells[2]?.textContent?.trim() ?? '';
    if (!row.dataset.closing) row.dataset.closing = cells[3]?.textContent?.trim() === '—' ? '' : cells[3]?.textContent?.trim() ?? '';
    if (!row.dataset.maxOperating) row.dataset.maxOperating = cells[4]?.textContent?.trim() === '—' ? '' : cells[4]?.textContent?.trim() ?? '';
    const badge = row.querySelector<HTMLElement>('.special-date-status');
    row.dataset.isOpen = badge?.classList.contains('open') ? 'true' : 'false';

    if (sessionStorage.getItem(hiddenKey(serviceDate)) === 'true') {
      row.hidden = true;
      return;
    }

    if (cells[0]) {
      cells[0].classList.add('special-date-cell-date');
      cells[0].textContent = formatUsDate(serviceDate);
    }
    for (const index of [2, 3, 4]) if (cells[index]) cells[index].textContent = formatClock(row.dataset[index === 2 ? 'opening' : index === 3 ? 'closing' : 'maxOperating'] ?? '');
    if (badge?.classList.contains('open')) badge.textContent = 'Open (special hours)';

    if (!row.querySelector('.special-date-note-cell')) {
      const noteCell = document.createElement('span');
      noteCell.className = 'special-date-note-cell';
      noteCell.textContent = sessionStorage.getItem(noteKey(serviceDate)) || '—';
      const actionsCell = document.createElement('span');
      actionsCell.className = 'special-date-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'special-date-action-button';
      edit.setAttribute('aria-label', `Edit special date ${formatUsDate(serviceDate)}`);
      edit.title = 'Edit special date';
      edit.innerHTML = actionIcon('edit');
      edit.addEventListener('click', () => openEditorForRow(row));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'special-date-action-button delete';
      remove.setAttribute('aria-label', `Remove special date ${formatUsDate(serviceDate)}`);
      remove.title = 'Remove special date';
      remove.innerHTML = actionIcon('delete');
      remove.addEventListener('click', () => {
        sessionStorage.setItem(hiddenKey(serviceDate), 'true');
        row.hidden = true;
      });
      actionsCell.append(edit, remove);
      row.append(noteCell, actionsCell);
    }
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
