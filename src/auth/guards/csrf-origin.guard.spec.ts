import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { CsrfOriginGuard } from './csrf-origin.guard';

describe('CsrfOriginGuard', () => {
  const config = {
    get: jest.fn().mockReturnValue('https://app.example.com'),
  } as unknown as ConfigService;
  const guard = new CsrfOriginGuard(config);
  const context = (method: string, origin?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method, headers: { origin } }),
      }),
    }) as unknown as ExecutionContext;

  it('allows safe methods without Origin', () =>
    expect(guard.canActivate(context('GET'))).toBe(true));
  it('rejects state-changing request without approved Origin', () =>
    expect(() => guard.canActivate(context('POST'))).toThrow(
      'Request origin is not allowed.',
    ));
  it('allows state-changing request from approved Origin', () =>
    expect(guard.canActivate(context('POST', 'https://app.example.com'))).toBe(
      true,
    ));
});
