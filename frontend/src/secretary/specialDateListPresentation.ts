function to12Hour(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return value || '—';
  const hour = Number(match[1]);
  const minute = match[2];
  if (!Number.isFinite(hour)) return value;
  return `${String(hour % 12 || 12).padStart(2, '0')}:${minute} ${hour >= 12 ? 'pm' : 'am'}`;
}

function draftId() {
  return /\/settings-drafts\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? 'draft';
}

function noteFor(serviceDate: string) {
  return sessionStorage.getItem(`clinic-special-note:${draftId()}:${serviceDate}`) || '—';
}

function deletedKey(serviceDate: string) {
  return `clinic-special-deleted:${draftId()}:${serviceDate}`;
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function actionIcon(kind: 'edit' | 'delete') {
  if (kind === 'edit') return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4Zm9.5-13.5 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7m4-7v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function openEditorFor(row: HTMLElement) {
  const serviceDate = row.dataset.serviceDate || '';
  const isOpen = row.dataset.isOpen === 'true';
  const opening = row.dataset.opening || '';
  const closing = row.dataset.closing || '';
  const addButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.special-date-heading button')).find((button) => button.textContent?.includes('Add special date'));
  addButton?.click();
  window.setTimeout(() => {
    const form = document.querySelector<HTMLFormElement>('.special-date-form');
    if (!form) return;
    const dateInputs = form.querySelectorAll<HTMLInputElement>('input[type="date"]');
    if (dateInputs[0]) setNativeValue(dateInputs[0], serviceDate);
    if (dateInputs[1]) setNativeValue(dateInputs[1], serviceDate);
    const radios = form.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const targetRadio = isOpen ? radios[0] : radios[1];
    targetRadio?.click();
    window.setTimeout(() => {
      if (isOpen) {
        const times = form.querySelectorAll<HTMLInputElement>('input[type="time"]');
        if (times[0]) setNativeValue(times[0], opening);
        if (times[1]) setNativeValue(times[1], closing);
      }
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, 0);
}

function transformList() {
  const table = document.querySelector<HTMLElement>('.special-date-table');
  if (!table || table.dataset.presentationReady === 'true') return;
  const head = table.querySelector<HTMLElement>('.special-date-table-head');
  const rows = Array.from(table.querySelectorAll<HTMLElement>('.special-date-table-row'));
  if (!head || !rows.length) return;

  head.innerHTML = '<span>Date</span><span>Status</span><span>Opening</span><span>Closing</span><span>Notes</span><span>Actions</span>';

  rows.forEach((row) => {
    const cells = Array.from(row.children) as HTMLElement[];
    if (cells.length < 5) return;
    const serviceDate = cells[0].textContent?.trim() || '';
    const isOpen = !cells[1].textContent?.toLowerCase().includes('closed');
    const openingRaw = cells[2].textContent?.trim() || '';
    const closingRaw = cells[3].textContent?.trim() || '';
    row.dataset.serviceDate = serviceDate;
    row.dataset.isOpen = String(isOpen);
    row.dataset.opening = openingRaw === '—' ? '' : openingRaw;
    row.dataset.closing = closingRaw === '—' ? '' : closingRaw;

    if (sessionStorage.getItem(deletedKey(serviceDate)) === '1') row.hidden = true;

    cells[1].innerHTML = `<span class="special-date-status ${isOpen ? 'open' : 'closed'}">${isOpen ? 'Open' : 'Closed'}</span>`;
    cells[2].textContent = isOpen && openingRaw !== '—' ? to12Hour(openingRaw) : '—';
    cells[3].textContent = isOpen && closingRaw !== '—' ? to12Hour(closingRaw) : '—';
    cells[4].className = 'special-date-note-cell';
    cells[4].textContent = noteFor(serviceDate);

    const actions = document.createElement('span');
    actions.className = 'special-date-actions';
    actions.innerHTML = `<button type="button" class="special-date-action-button edit" aria-label="Edit ${serviceDate}" title="Edit special date">${actionIcon('edit')}</button><button type="button" class="special-date-action-button delete" aria-label="Delete ${serviceDate}" title="Delete special date">${actionIcon('delete')}</button>`;
    actions.querySelector<HTMLButtonElement>('.edit')?.addEventListener('click', () => openEditorFor(row));
    actions.querySelector<HTMLButtonElement>('.delete')?.addEventListener('click', () => {
      sessionStorage.setItem(deletedKey(serviceDate), '1');
      row.hidden = true;
    });
    row.append(actions);
  });

  table.dataset.presentationReady = 'true';
}

function scheduleTransform() {
  window.setTimeout(transformList, 0);
  window.setTimeout(transformList, 120);
}

export function installSpecialDateListPresentation() {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.secretary-proposal-nav') || target.closest('.special-date-editor')) scheduleTransform();
  }, true);
  scheduleTransform();
}
