import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureGuidancePanel } from './clinic-guidance-status';

function visitStep(step: number) {
  window.history.replaceState({}, '', `/app/clinics?clinic=test-clinic&step=${step}`);
  ensureGuidancePanel();
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('clinic setup guidance navigation', () => {
  it('refreshes saved completion across steps and recognizes serialized schedule times', async () => {
    let saved = {
      id: 'test-clinic', name: 'Clinic', addressLine1: 'Street', countryCode: 'PH', timeZone: 'Asia/Manila',
      practiceSchedules: [] as Record<string, unknown>[], services: [] as unknown[], bookingQuestions: [] as unknown[],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [saved] })));
    document.body.innerHTML = '<div class="clinic-setup-layout"></div>';
    visitStep(2);
    window.dispatchEvent(new Event('clinic-configuration-saved'));
    const row = (label: string) => document.querySelector(`[data-guidance-label="${label}"]`);
    await vi.waitFor(() => expect(row('Clinic hours and schedules')).toHaveClass('is-incomplete'));
    saved = { ...saved, practiceSchedules: [{ isOpen: true, opensAtLocal: '1970-01-01T08:00:00.000Z', closesAtLocal: '1970-01-01T17:00:00.000Z', maximumOperatingUntilLocal: '1970-01-01T18:00:00.000Z' }], services: [{}], bookingQuestions: [{}] };
    window.dispatchEvent(new Event('clinic-configuration-saved'));
    await vi.waitFor(() => expect(row('Clinic hours and schedules')).toHaveClass('is-complete'));
    expect(row('Services offered')).toHaveClass('is-complete');
    expect(row('Booking questions')).toHaveClass('is-complete');
    expect(row('Review before activation')).toHaveClass('is-complete');
    visitStep(5);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(row('Review before activation')).toHaveClass('is-complete'));
    saved = { ...saved, practiceSchedules: [], services: [], bookingQuestions: [] };
    window.dispatchEvent(new Event('clinic-configuration-saved'));
    await vi.waitFor(() => expect(row('Clinic hours and schedules')).toHaveClass('is-incomplete'));
    expect(row('Services offered')).toHaveClass('is-incomplete');
    expect(row('Booking questions')).toHaveClass('is-incomplete');
    expect(row('Review before activation')).toHaveClass('is-incomplete');
  });
  it('replaces guidance on forward and backward navigation without duplicates', () => {
    document.body.innerHTML = '<div class="clinic-setup-layout"></div>';
    for (const [step, heading] of [
      [2, 'About Clinic Hours'],
      [3, 'About Clinic Services'],
      [4, 'About Clinic Questions'],
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
