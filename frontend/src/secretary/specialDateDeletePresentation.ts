import { apiRequest } from '../api/client';

function currentDraftId() {
  return /\/settings-drafts\/([^/?#]+)/.exec(window.location.pathname)?.[1] ?? '';
}

function showNotice(message: string, error = false) {
  const existing = document.querySelector<HTMLElement>('[data-special-date-delete-notice="true"]');
  existing?.remove();
  const notice = document.createElement('div');
  notice.dataset.specialDateDeleteNotice = 'true';
  notice.className = `secretary-action-toast ${error ? 'error' : 'success'}`;
  notice.setAttribute('role', error ? 'alert' : 'status');
  notice.innerHTML = `<span class="secretary-toast-icon">${error ? '!' : '✓'}</span><span>${message}</span>`;
  document.querySelector('.secretary-proposal-header')?.insertAdjacentElement('afterend', notice);
  window.setTimeout(() => notice.remove(), 3200);
}

export function installSpecialDateDeletePresentation() {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('.special-date-action-button.delete');
    if (!button || button.dataset.deleting === 'true') return;

    event.preventDefault();
    event.stopPropagation();

    const row = button.closest<HTMLElement>('.special-date-table-row');
    const serviceDate = row?.dataset.serviceDate || row?.firstElementChild?.textContent?.trim() || '';
    const draftId = currentDraftId();
    if (!row || !serviceDate || !draftId) return;

    button.dataset.deleting = 'true';
    button.disabled = true;

    void apiRequest<{ deleted: true }>(
      `/secretary-settings-drafts/${encodeURIComponent(draftId)}/schedule-exception/${encodeURIComponent(serviceDate)}`,
      { method: 'DELETE' },
    )
      .then(() => {
        row.remove();
        showNotice(`Special date ${serviceDate} deleted from this draft.`);
      })
      .catch((error: unknown) => {
        button.dataset.deleting = 'false';
        button.disabled = false;
        showNotice(error instanceof Error ? error.message : 'Unable to delete this special date.', true);
      });
  }, true);
}
