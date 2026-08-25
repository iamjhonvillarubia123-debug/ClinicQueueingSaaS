function formatUsTyping(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function to12Hour(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i.exec(value.trim());
  if (!match) return value || '—';
  if (match[3]) return `${String(Number(match[1])).padStart(2, '0')}:${match[2]} ${match[3].toLowerCase()}`;
  const hour = Number(match[1]);
  return `${String(hour % 12 || 12).padStart(2, '0')}:${match[2]} ${hour >= 12 ? 'pm' : 'am'}`;
}

function currentDraftId() {
  return /\/settings-drafts\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? 'draft';
}

function noteFor(serviceDate: string) {
  return sessionStorage.getItem(`clinic-special-note:${currentDraftId()}:${serviceDate}`) || '—';
}

function stabilizeHeader() {
  const page = document.querySelector<HTMLElement>('.secretary-proposal-page');
  const header = page?.querySelector<HTMLElement>('.secretary-proposal-header');
  if (!page || !header) return;
  const eyebrow = header.querySelector<HTMLElement>('.eyebrow');
  const heading = header.querySelector<HTMLElement>('h1');
  const badge = header.querySelector<HTMLElement>('.practice-status');
  if (!eyebrow || !heading) return;
  const small = eyebrow.textContent?.trim() ?? '';
  const large = heading.textContent?.trim() ?? '';
  if (!page.dataset.stableClinicName) {
    if (small && small.toLowerCase() !== 'clinic configuration') page.dataset.stableClinicName = small;
    else if (large && large.toLowerCase() !== 'clinic configuration') page.dataset.stableClinicName = large;
  }
  if (eyebrow.textContent !== 'Clinic configuration') eyebrow.textContent = 'Clinic configuration';
  if (page.dataset.stableClinicName && heading.textContent !== page.dataset.stableClinicName) heading.textContent = page.dataset.stableClinicName;
  if (badge?.textContent?.trim().toLowerCase() === 'draft') badge.classList.add('draft');
}

function stabilizeDateInputs() {
  document.querySelectorAll<HTMLInputElement>('[data-special-us-date]').forEach((input) => {
    if (input.dataset.autoSlash === 'true') return;
    input.dataset.autoSlash = 'true';
    input.addEventListener('input', () => {
      const next = formatUsTyping(input.value);
      if (input.value !== next) input.value = next;
    });
  });
}

function stabilizeTable() {
  const editor = document.querySelector<HTMLElement>('.special-date-editor');
  if (!editor) return;
  const head = editor.querySelector<HTMLElement>('.special-date-table-head');
  if (head) {
    const headers = Array.from(head.children) as HTMLElement[];
    ['Date / range', 'Status', 'Opening', 'Closing', 'Notes', 'Actions'].forEach((text, i) => {
      if (headers[i] && headers[i].textContent !== text) headers[i].textContent = text;
    });
  }

  editor.querySelectorAll<HTMLElement>('.special-date-table-row').forEach((row) => {
    const detail = row.querySelector<HTMLElement>('.special-date-row-detail');
    detail?.remove();
    const cells = Array.from(row.children) as HTMLElement[];
    const serviceDate = row.dataset.serviceDate || cells[0]?.textContent?.trim() || '';
    if (!serviceDate) return;
    const opening = row.dataset.opening || cells[2]?.textContent?.trim() || '';
    const closing = row.dataset.closing || cells[3]?.textContent?.trim() || '';
    if (cells[2]) cells[2].textContent = opening && opening !== '—' ? to12Hour(opening) : '—';
    if (cells[3]) cells[3].textContent = closing && closing !== '—' ? to12Hour(closing) : '—';
    if (cells[4]) cells[4].textContent = noteFor(serviceDate);
    row.removeAttribute('role');
    row.removeAttribute('aria-expanded');
    row.removeAttribute('tabindex');

    const edit = row.querySelector<HTMLButtonElement>('.special-date-action-button:not(.delete)');
    if (edit && edit.dataset.guidance !== 'true') {
      edit.dataset.guidance = 'true';
      edit.addEventListener('click', () => window.setTimeout(() => {
        const form = document.querySelector<HTMLFormElement>('.special-date-form');
        const title = form?.querySelector<HTMLElement>('.special-wizard-title');
        if (title) title.textContent = 'Edit special date';
        if (form) {
          let hint = form.querySelector<HTMLElement>('.special-edit-hint');
          if (!hint) {
            hint = document.createElement('p');
            hint.className = 'special-edit-hint';
            form.querySelector('.special-wizard-stepper')?.after(hint);
          }
          hint.textContent = 'Editing this special-date proposal. Review the steps below, then save the updated proposal.';
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 25));
    }

    const remove = row.querySelector<HTMLButtonElement>('.special-date-action-button.delete');
    if (remove && remove.dataset.guidance !== 'true') {
      remove.dataset.guidance = 'true';
      remove.addEventListener('click', () => {
        row.style.display = 'none';
        const page = document.querySelector<HTMLElement>('.secretary-proposal-page');
        let notice = page?.querySelector<HTMLElement>('.special-delete-notice');
        if (page && !notice) {
          notice = document.createElement('div');
          notice.className = 'special-delete-notice practice-notice';
          page.prepend(notice);
        }
        if (notice) notice.textContent = 'Special-date proposal removed from this UI preview.';
      });
    }
  });
}

function refreshStableUi() {
  stabilizeHeader();
  stabilizeDateInputs();
  stabilizeTable();
}

export function installSecretaryUiStabilityFixes() {
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; refreshStableUi(); });
  };
  new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', refresh, true);
  document.addEventListener('change', refresh, true);
  refresh();
}
