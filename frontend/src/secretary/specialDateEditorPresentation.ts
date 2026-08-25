function digitsToUsDate(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function isoToUsDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
}

function usDateToIso(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 9999) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function setNativeDate(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function enhanceDateInput(nativeInput: HTMLInputElement, index: number) {
  if (nativeInput.dataset.usDateEnhanced === 'true') return;
  nativeInput.dataset.usDateEnhanced = 'true';
  nativeInput.classList.add('special-date-native-date');
  nativeInput.tabIndex = -1;
  nativeInput.setAttribute('aria-hidden', 'true');

  const display = document.createElement('input');
  display.type = 'text';
  display.inputMode = 'numeric';
  display.autocomplete = 'off';
  display.maxLength = 10;
  display.placeholder = 'MM/DD/YYYY';
  display.className = 'special-date-us-date';
  display.setAttribute('aria-label', index === 0 ? 'Start date MM/DD/YYYY' : 'End date MM/DD/YYYY');
  display.value = isoToUsDate(nativeInput.value);

  display.addEventListener('input', () => {
    const formatted = digitsToUsDate(display.value);
    if (display.value !== formatted) display.value = formatted;
    display.setCustomValidity('');
    const iso = usDateToIso(formatted);
    if (formatted.length === 10 && !iso) {
      display.setCustomValidity('Enter a valid date in MM/DD/YYYY format.');
      return;
    }
    if (iso) {
      setNativeDate(nativeInput, iso);
      window.setTimeout(enhanceSpecialDateEditor, 0);
    }
  });

  display.addEventListener('blur', () => {
    if (display.value && !usDateToIso(display.value)) {
      display.setCustomValidity('Enter a valid date in MM/DD/YYYY format.');
      display.reportValidity();
    }
  });

  nativeInput.insertAdjacentElement('beforebegin', display);
}

export function enhanceSpecialDateEditor() {
  const form = document.querySelector<HTMLFormElement>('.special-date-form');
  if (!form) return;
  const dateInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  dateInputs.forEach(enhanceDateInput);
}

export function installSpecialDateEditorPresentation() {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.special-date-heading') || target.closest('.special-date-form') || target.closest('.secretary-proposal-nav')) {
      window.setTimeout(enhanceSpecialDateEditor, 0);
    }
  }, true);
  window.setTimeout(enhanceSpecialDateEditor, 0);
}
