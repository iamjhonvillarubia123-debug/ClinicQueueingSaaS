const TARGET = 'input[list="clinic-quarter-hour-options"]';

type ParsedTime = { minutes: number; formatted: string };

function formatMinutes(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function parseFlexibleTime(raw: string): ParsedTime | null {
  const value = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!value) return null;

  const match = value.match(/^(0?[1-9]|1[0-2])(?:[:.]?([0-5]\d))?\s*(AM|PM)$/);
  if (!match) return null;

  let hour = Number(match[1]) % 12;
  const minute = match[2] ? Number(match[2]) : 0;
  if (match[3] === 'PM') hour += 12;
  const minutes = hour * 60 + minute;
  return { minutes, formatted: formatMinutes(minutes) };
}

function nearestQuarter(minutes: number) {
  return Math.round(minutes / 15) * 15;
}

function suggestionTimes(input: HTMLInputElement) {
  const parsed = parseFlexibleTime(input.value);
  const center = parsed ? nearestQuarter(parsed.minutes) : 8 * 60;
  return Array.from({ length: 11 }, (_, index) => formatMinutes(center + (index - 5) * 15));
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function enhanceInput(input: HTMLInputElement) {
  if (input.dataset.exactTimeEnhanced === 'true') return;
  input.dataset.exactTimeEnhanced = 'true';
  input.removeAttribute('list');
  input.classList.add('clinic-exact-time-input');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('inputmode', 'text');
  input.setAttribute('aria-haspopup', 'listbox');
}

function enhanceAll(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>(TARGET).forEach(enhanceInput);
}

function install() {
  if ((window as Window & { __clinicTimeEnhancerInstalled?: boolean }).__clinicTimeEnhancerInstalled) return;
  (window as Window & { __clinicTimeEnhancerInstalled?: boolean }).__clinicTimeEnhancerInstalled = true;

  const popup = document.createElement('div');
  popup.className = 'clinic-time-popup';
  popup.setAttribute('role', 'listbox');
  popup.hidden = true;
  document.body.appendChild(popup);

  let activeInput: HTMLInputElement | null = null;

  function closePopup() {
    popup.hidden = true;
    popup.replaceChildren();
    activeInput?.setAttribute('aria-expanded', 'false');
  }

  function positionPopup(input: HTMLInputElement) {
    const rect = input.getBoundingClientRect();
    popup.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    popup.style.top = `${Math.round(rect.bottom + window.scrollY + 6)}px`;
    popup.style.width = `${Math.max(180, Math.round(rect.width))}px`;
  }

  function openPopup(input: HTMLInputElement) {
    if (input.disabled) return;
    activeInput = input;
    popup.replaceChildren();
    suggestionTimes(input).forEach((time) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'clinic-time-option';
      option.textContent = time;
      option.setAttribute('role', 'option');
      if (parseFlexibleTime(input.value)?.formatted === time) option.classList.add('is-selected');
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        setReactInputValue(input, time);
        closePopup();
        input.focus();
      });
      popup.appendChild(option);
    });
    positionPopup(input);
    popup.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(TARGET)) enhanceInput(node as HTMLInputElement);
        enhanceAll(node);
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhanceAll();

  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('clinic-exact-time-input')) return;
    openPopup(target);
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.classList.contains('clinic-exact-time-input')) {
      openPopup(target);
      return;
    }
    if (!popup.contains(target as Node)) closePopup();
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('clinic-exact-time-input')) return;
    openPopup(target);
  });

  document.addEventListener('focusout', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('clinic-exact-time-input')) return;
    const parsed = parseFlexibleTime(target.value);
    if (parsed && target.value !== parsed.formatted) setReactInputValue(target, parsed.formatted);
    window.setTimeout(() => {
      if (!popup.matches(':hover')) closePopup();
    }, 0);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopup();
  });

  window.addEventListener('resize', () => activeInput && !popup.hidden && positionPopup(activeInput));
  window.addEventListener('scroll', () => activeInput && !popup.hidden && positionPopup(activeInput), true);
}

install();
