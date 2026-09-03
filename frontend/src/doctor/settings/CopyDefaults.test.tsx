import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CopyDefaults } from './CopyDefaults';
afterEach(() => vi.restoreAllMocks());
it('reviews selected templates, preserves error state, and uses the same key for a retry', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async (_url, options) =>
        new Response(
          JSON.stringify(
            options?.method
              ? { message: 'Capacity exceeded. Nothing changed.' }
              : [{ id: 'clinic', name: 'North', lifecycleStatus: 'ACTIVE' }],
          ),
          {
            status: options?.method ? 409 : 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
  render(
    <CopyDefaults
      kind="both"
      defaults={{
        services: [
          { id: 's1', name: 'Consultation' },
          { id: 's2', name: 'Follow-up' },
        ],
        bookingQuestions: [{ id: 'q1', questionText: 'Reason?' }],
      }}
      busy={false}
      setBusy={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Copy mode'), 'selected');
  await user.click(screen.getByRole('checkbox', { name: 'Follow-up' }));
  await user.click(await screen.findByRole('checkbox', { name: 'North' }));
  await user.click(screen.getByRole('button', { name: 'Review Copy' }));
  expect(
    fetchMock.mock.calls.filter(([, options]) => options?.method),
  ).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Confirm Copy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Capacity exceeded',
  );
  await user.click(screen.getByRole('button', { name: 'Confirm Copy' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method),
    ).toHaveLength(2),
  );
  const writes = fetchMock.mock.calls.filter(([, options]) => options?.method);
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual({
    practiceLocationIds: ['clinic'],
    serviceTemplateIds: ['s2'],
    bookingQuestionTemplateIds: [],
  });
  expect(new Headers(writes[0][1]?.headers).get('Idempotency-Key')).toEqual(
    new Headers(writes[1][1]?.headers).get('Idempotency-Key'),
  );
});
