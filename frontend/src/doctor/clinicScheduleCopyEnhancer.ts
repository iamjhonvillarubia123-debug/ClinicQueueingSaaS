type CopiedSchedule = {
  sourceRow: HTMLElement;
  opens: string;
  closes: string;
  maximumUntil: string;
};

function setReactInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function rowFields(row: HTMLElement) {
  const timeInputs = Array.from(row.querySelectorAll<HTMLInputElement>('input.clinic-exact-time-input'));
  return {
    openToggle: row.querySelector<HTMLInputElement>('input[type="checkbox"]'),
    opens: timeInputs[0],
    closes: timeInputs[1],
    maximumUntil: timeInputs[2],
  };
}

function rowName(row: HTMLElement) {
  return row.querySelector('strong')?.textContent?.trim() || 'day';
}

function install() {
  if ((window as Window & { __clinicScheduleCopyInstalled?: boolean }).__clinicScheduleCopyInstalled) return;
  (window as Window & { __clinicScheduleCopyInstalled?: boolean }).__clinicScheduleCopyInstalled = true;

  let copied: CopiedSchedule | null = null;

  function refreshButtons() {
    document.querySelectorAll<HTMLElement>('.clinic-hours-row').forEach((row) => {
      const button = row.querySelector<HTMLButtonElement>('.clinic-schedule-copy-action');
      if (!button) return;
      const { openToggle } = rowFields(row);
      const isOpen = Boolean(openToggle?.checked);
      const isSource = copied?.sourceRow === row;

      button.disabled = !isOpen;
      button.textContent = copied && !isSource ? '⇩' : '⧉';
      button.classList.toggle('is-paste', Boolean(copied && !isSource));
      button.classList.toggle('is-source', Boolean(isSource));
      button.title = copied && !isSource
        ? `Paste ${rowName(copied.sourceRow)} schedule to ${rowName(row)}`
        : `Copy ${rowName(row)} schedule`;
      button.setAttribute('aria-label', button.title);
    });
  }

  function enhanceRow(row: HTMLElement) {
    if (row.querySelector('.clinic-schedule-copy-action')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'clinic-schedule-copy-action';
    button.addEventListener('click', () => {
      const fields = rowFields(row);
      if (!fields.openToggle?.checked || !fields.opens || !fields.closes || !fields.maximumUntil) return;

      if (!copied || copied.sourceRow === row) {
        copied = {
          sourceRow: row,
          opens: fields.opens.value,
          closes: fields.closes.value,
          maximumUntil: fields.maximumUntil.value,
        };
        refreshButtons();
        return;
      }

      setReactInputValue(fields.opens, copied.opens);
      setReactInputValue(fields.closes, copied.closes);
      setReactInputValue(fields.maximumUntil, copied.maximumUntil);
      button.classList.add('just-pasted');
      window.setTimeout(() => button.classList.remove('just-pasted'), 700);
    });
    row.appendChild(button);
  }

  function enhanceHours() {
    const table = document.querySelector<HTMLElement>('.clinic-hours-table');
    if (!table) return;
    table.classList.add('has-schedule-actions');
    table.querySelectorAll<HTMLElement>('.clinic-hours-row').forEach(enhanceRow);
    refreshButtons();
  }

  const observer = new MutationObserver(() => enhanceHours());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhanceHours();

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'checkbox' && target.closest('.clinic-hours-row')) refreshButtons();
  });
}

install();
