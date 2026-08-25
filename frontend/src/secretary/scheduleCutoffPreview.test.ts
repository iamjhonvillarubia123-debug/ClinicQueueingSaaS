import { afterEach, describe, expect, it } from 'vitest';
import { installScheduleCutoffPreview } from './scheduleCutoffPreview';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('schedule cutoff preview', () => {
  it('shows the calculated per-day cutoff from the clinic-wide allowance', async () => {
    document.body.innerHTML = `
      <section class="schedule-editor">
        <div class="weekly-schedule-row">
          <label class="weekly-day"><input type="checkbox" checked /></label>
          <input aria-label="Monday closes" value="17:00" />
        </div>
        <input aria-label="Online cutoff hours before clinic closing" value="1" />
      </section>
    `;

    installScheduleCutoffPreview();
    document.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();

    expect(document.querySelector<HTMLElement>('.weekly-schedule-row')?.dataset.cutoffLabel).toBe('04:00 pm');
  });
});
