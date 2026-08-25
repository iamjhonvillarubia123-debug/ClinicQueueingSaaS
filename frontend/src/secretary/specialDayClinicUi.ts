function replaceTextNode(element: HTMLElement, from: string, to: string) {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === from) {
      node.textContent = node.textContent.replace(from, to);
      return;
    }
  }
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function stepItem(number: number, label: string) {
  const item = document.createElement('div');
  item.className = 'special-wizard-step';
  item.innerHTML = `<span>${number}</span><strong>${label}</strong>`;
  return item;
}

function applyStep(form: HTMLFormElement, step: number) {
  form.dataset.specialStep = String(step);
  form.querySelectorAll<HTMLElement>('.special-wizard-step').forEach((item, index) => {
    item.classList.toggle('active', index + 1 === step);
    item.classList.toggle('complete', index + 1 < step);
  });

  const grid = form.querySelector<HTMLElement>('.special-date-form-grid');
  const dateLabels = grid ? Array.from(grid.querySelectorAll<HTMLElement>(':scope > label')).slice(0, 2) : [];
  const type = grid?.querySelector<HTMLElement>('.special-date-type');
  const hours = grid?.querySelector<HTMLElement>('.special-date-hours');
  const review = form.querySelector<HTMLElement>('.special-wizard-review');

  dateLabels.forEach((node) => { node.hidden = step !== 1; });
  if (type) type.hidden = step !== 1;
  if (hours) hours.hidden = step !== 2;
  if (review) review.hidden = step !== 3;

  const nav = form.querySelector<HTMLElement>('.special-wizard-nav');
  if (!nav) return;
  const back = nav.querySelector<HTMLButtonElement>('[data-special-back]');
  const next = nav.querySelector<HTMLButtonElement>('[data-special-next]');
  const save = nav.querySelector<HTMLButtonElement>('[data-special-save]');
  if (back) back.hidden = step === 1;
  if (next) next.hidden = step === 3;
  if (save) save.hidden = step !== 3;
}

function updateReview(form: HTMLFormElement) {
  const review = form.querySelector<HTMLElement>('.special-wizard-review');
  if (!review) return;
  const dates = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  const open = form.querySelector<HTMLInputElement>('input[name="special-date-type"]:checked');
  const times = Array.from(form.querySelectorAll<HTMLInputElement>('.special-date-hours input[type="time"]'));
  const isOpen = open?.closest('label')?.textContent?.includes('Open') ?? true;
  review.innerHTML = `
    <h4>Review special date</h4>
    <dl>
      <div><dt>Date</dt><dd>${dates[0]?.value || 'Not selected'}${dates[1]?.value && dates[1].value !== dates[0]?.value ? ` → ${dates[1].value}` : ''}</dd></div>
      <div><dt>Type</dt><dd>${isOpen ? 'Open (special hours)' : 'Closed'}</dd></div>
      ${isOpen ? `<div><dt>Hours</dt><dd>${times[0]?.value || '—'} – ${times[1]?.value || '—'}</dd></div><div><dt>Max operating until</dt><dd>${times[2]?.value || '—'}</dd></div>` : ''}
    </dl>`;
}

function enhanceForm(form: HTMLFormElement) {
  if (form.dataset.specialEnhanced === 'true') return;
  form.dataset.specialEnhanced = 'true';
  form.dataset.specialStep = '1';

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
    type?.querySelectorAll('label').forEach((label) => {
      const text = label.textContent || '';
      if (text.includes('Open with special hours')) {
        label.querySelector('strong')!.textContent = 'Open (special hours)';
        const small = label.querySelector('small');
        if (small) small.textContent = 'Clinic will be open with different hours.';
      }
      if (text.includes('Clinic closed')) {
        label.querySelector('strong')!.textContent = 'Closed';
        const small = label.querySelector('small');
        if (small) small.textContent = 'Clinic will be closed all day.';
      }
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
    <button class="primary" type="button" data-special-save hidden>Add special date</button>`;
  form.append(nav);

  nav.querySelector<HTMLButtonElement>('[data-special-back]')?.addEventListener('click', () => {
    const current = Number(form.dataset.specialStep || '1');
    applyStep(form, Math.max(1, current - 1));
  });
  nav.querySelector<HTMLButtonElement>('[data-special-next]')?.addEventListener('click', () => {
    const current = Number(form.dataset.specialStep || '1');
    if (current === 1) {
      const start = form.querySelector<HTMLInputElement>('input[type="date"]');
      if (!start?.value) { start?.reportValidity(); return; }
      const selected = form.querySelector<HTMLInputElement>('input[name="special-date-type"]:checked');
      const isOpen = selected?.closest('label')?.textContent?.includes('Open') ?? true;
      if (!isOpen) { updateReview(form); applyStep(form, 3); return; }
      applyStep(form, 2); return;
    }
    updateReview(form); applyStep(form, 3);
  });
  nav.querySelector<HTMLButtonElement>('[data-special-save]')?.addEventListener('click', () => form.requestSubmit());
  applyStep(form, 1);
}

function formatClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? 'pm' : 'am';
  const twelve = hour % 12 || 12;
  return `${String(twelve).padStart(2, '0')}:${match[2]} ${suffix}`;
}

function enhanceTable(editor: HTMLElement) {
  const head = editor.querySelector<HTMLElement>('.special-date-table-head');
  if (!head || head.dataset.specialEnhanced === 'true') return;
  head.dataset.specialEnhanced = 'true';
  const headers = Array.from(head.children) as HTMLElement[];
  if (headers[0]) headers[0].textContent = 'Date / range';
  headers.forEach((header) => {
    if (header.textContent === 'Max operating until') return;
  });

  editor.querySelectorAll<HTMLElement>('.special-date-table-row').forEach((row) => {
    const cells = Array.from(row.children) as HTMLElement[];
    if (cells[0]) cells[0].classList.add('special-date-cell-date');
    for (const index of [2, 3, 4]) if (cells[index] && cells[index].textContent) cells[index].textContent = formatClock(cells[index].textContent || '');
    const badge = row.querySelector<HTMLElement>('.special-date-status');
    if (badge?.classList.contains('open')) badge.textContent = 'Open (special hours)';
  });
}

function enhanceSpecialDayClinic() {
  document.querySelectorAll<HTMLButtonElement>('.secretary-proposal-nav button').forEach((button) => {
    if (button.textContent?.includes('Special dates')) replaceTextNode(button, 'Special dates', 'Special day clinic');
  });

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
  enhanceTable(editor);
}

export function installSpecialDayClinicUi() {
  const refresh = () => queueMicrotask(enhanceSpecialDayClinic);
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', refresh, true);
  refresh();
}
