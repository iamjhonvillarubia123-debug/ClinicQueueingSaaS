import { afterEach, describe, expect, it } from 'vitest';
import { ensureGuidancePanel } from './clinic-guidance-status';

function visitStep(step: number) {
  window.history.replaceState({}, '', `/app/clinics?clinic=test-clinic&step=${step}`);
  ensureGuidancePanel();
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
});

describe('clinic setup guidance navigation', () => {
  it('replaces guidance on forward and backward navigation without duplicates', () => {
    document.body.innerHTML = '<div class="clinic-setup-layout"></div>';
    for (const [step, heading] of [
      [2, 'About Clinic Hours'],
      [3, 'About Services'],
      [4, 'About Booking Questions'],
      [5, 'Before Activation'],
      [2, 'About Clinic Hours'],
      [5, 'Before Activation'],
    ] as const) {
      visitStep(step);
      expect(document.querySelectorAll('.clinic-setup-guidance')).toHaveLength(1);
      expect(document.querySelector('.clinic-journey-context-card h3')?.textContent).toBe(heading);
      expect(document.querySelectorAll('.clinic-hours-guide-card')).toHaveLength(step === 2 ? 1 : 0);
      const panel = document.querySelector('.clinic-setup-guidance');
      ensureGuidancePanel();
      expect(document.querySelector('.clinic-setup-guidance')).toBe(panel);
    }
  });

  it('removes generated hours guidance and preserves the Basic Information panel', () => {
    document.body.innerHTML = '<div class="clinic-setup-layout"></div>';
    visitStep(2);
    const basicPanel = document.createElement('aside');
    basicPanel.className = 'clinic-setup-guidance';
    basicPanel.innerHTML = '<section class="clinic-guide-card"><h3>About Clinic Photos</h3></section>';
    document.querySelector('.clinic-setup-layout')!.appendChild(basicPanel);
    visitStep(1);
    expect(document.querySelectorAll('.clinic-setup-guidance')).toHaveLength(1);
    expect(document.querySelector('.clinic-setup-guidance')).toBe(basicPanel);
    expect(document.querySelector('[data-journey-guidance]')).toBeNull();
    basicPanel.remove();
    visitStep(2);
    expect(document.querySelector('.clinic-journey-context-card h3')?.textContent).toBe('About Clinic Hours');
  });
});
