function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function formatTime(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hours24 >= 12 ? 'pm' : 'am';
  const hours12 = hours24 % 12 || 12;
  return `${String(hours12).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${suffix}`;
}

function refreshScheduleCutoffPreview() {
  const editor = document.querySelector<HTMLElement>('.schedule-editor');
  if (!editor) return;

  const cutoffInput = editor.querySelector<HTMLInputElement>('input[aria-label="Online cutoff hours before clinic closing"]');
  const hours = cutoffInput ? Number(cutoffInput.value) : Number.NaN;

  editor.querySelectorAll<HTMLElement>('.weekly-schedule-row').forEach((row) => {
    const openCheckbox = row.querySelector<HTMLInputElement>('.weekly-day input[type="checkbox"]');
    const closingInput = row.querySelector<HTMLInputElement>('input[aria-label$=" closes"]');

    if (!openCheckbox?.checked) {
      row.dataset.cutoffLabel = '—';
      return;
    }

    if (!cutoffInput?.value.trim()) {
      row.dataset.cutoffLabel = 'Set clinic cutoff';
      return;
    }

    const closing = closingInput ? timeToMinutes(closingInput.value) : null;
    if (closing === null || !Number.isFinite(hours) || hours < 0) {
      row.dataset.cutoffLabel = 'Invalid cutoff';
      return;
    }

    const cutoff = closing - Math.round(hours * 60);
    row.dataset.cutoffLabel = cutoff >= 0 ? formatTime(cutoff) : 'Invalid cutoff';
  });
}

export function installScheduleCutoffPreview() {
  const refresh = () => queueMicrotask(refreshScheduleCutoffPreview);
  document.addEventListener('input', refresh, true);
  document.addEventListener('change', refresh, true);

  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  refresh();
}
