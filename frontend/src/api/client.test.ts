import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';

afterEach(() => vi.restoreAllMocks());

describe('apiRequest', () => {
  it('uses credentialed browser requests for the HttpOnly session cookie', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await apiRequest('/auth/profile');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/profile'), expect.objectContaining({ credentials: 'include' }));
  });

  it('does not invent a bearer authorization header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await apiRequest('/auth/profile');
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
  });

  it('surfaces validation message arrays returned by the backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 400,
          message: ['email must be an email', 'firstName should not be empty'],
          requestId: 'req-1',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(apiRequest('/secretary/register', { method: 'POST', body: {} })).rejects.toMatchObject({
      message: 'email must be an email firstName should not be empty',
      status: 400,
      requestId: 'req-1',
    });
  });
});
