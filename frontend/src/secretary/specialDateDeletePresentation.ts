function currentDraftId() {
  return /\/settings-drafts\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? 'draft';
}

function deletedKey(serviceDate: string) {
  return `clinic-special-deleted:${currentDraftId()}:${serviceDate}`;
}

function showDeletedNotice(serviceDate: string) {
  const existing = document.querySelector<HTMLElement>('[data-special-date-delete-notice="true"]');
  existing?.remove();
  const notice = document.createElement('div');
  notice.dataset.specialDateDeleteNotice = 'true';
  notice.className = 'secretary-action-toast success';
  notice.setAttribute('role', 'status');
  notice.innerHTML = `<span class="secretary-toast-icon">✓</span><span>Special date ${serviceDate} removed from this draft view.</span>`;
  document.querySelector('.secretary-proposal-header')?.insertAdjacentElement('afterend', notice);
  window.setTimeout(() => notice.remove(), 2800);
}

export function installSpecialDateDeletePresentation() {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('.special-date-action-button.delete');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const row = button.closest<HTMLElement>('.special-date-table-row');
    const serviceDate = row?.dataset.serviceDate || row?.firstElementChild?.textContent?.trim() || '';
    if (!row || !serviceDate) return;

    sessionStorage.setItem(deletedKey(serviceDate), '1');
    row.remove();
    showDeletedNotice(serviceDate);
  }, true);
}
