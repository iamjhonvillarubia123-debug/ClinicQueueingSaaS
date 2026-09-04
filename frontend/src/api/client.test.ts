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
});
