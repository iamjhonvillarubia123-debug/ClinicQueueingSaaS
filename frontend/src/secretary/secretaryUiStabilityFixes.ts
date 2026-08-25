function applyApprovedHeader() {
  const page = document.querySelector<HTMLElement>('.secretary-proposal-page');
  const header = page?.querySelector<HTMLElement>('.secretary-proposal-header');
  if (!page || !header) return;

  const eyebrow = header.querySelector<HTMLElement>('.eyebrow');
  const heading = header.querySelector<HTMLElement>('h1');
  const badge = header.querySelector<HTMLElement>('.practice-status');
  if (!eyebrow || !heading) return;

  const eyebrowText = eyebrow.textContent?.trim() ?? '';
  const headingText = heading.textContent?.trim() ?? '';
  if (!page.dataset.approvedClinicName) {
    if (eyebrowText && eyebrowText.toLowerCase() !== 'clinic configuration') {
      page.dataset.approvedClinicName = eyebrowText;
    } else if (headingText && headingText.toLowerCase() !== 'clinic configuration') {
      page.dataset.approvedClinicName = headingText;
    }
  }

  eyebrow.textContent = 'Clinic configuration';
  if (page.dataset.approvedClinicName) heading.textContent = page.dataset.approvedClinicName;
  if (badge?.textContent?.trim().toLowerCase() === 'draft') badge.classList.add('draft');
}

export function installSecretaryUiStabilityFixes() {
  let attempts = 0;
  const timer = window.setInterval(() => {
    applyApprovedHeader();
    attempts += 1;
    if (attempts >= 40 || document.querySelector('.secretary-proposal-header')) {
      window.clearInterval(timer);
    }
  }, 100);

  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (target?.closest('.secretary-proposal-nav')) {
      window.requestAnimationFrame(applyApprovedHeader);
    }
  });
}