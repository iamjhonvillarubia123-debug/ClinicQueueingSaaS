import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESSION_COOKIE_NAME } from '../security/session-security';
import { CsrfOriginGuard } from './csrf-origin.guard';

describe('CsrfOriginGuard', () => {
  const configValues: Record<string, string> = {
    NODE_ENV: 'test',
    WEB_APP_ORIGIN: 'https://app.example.com',
  };
  const config = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;
  const guard = new CsrfOriginGuard(config);
  const context = (
    method: string,
    origin?: string,
    cookieName: string | null = SESSION_COOKIE_NAME,
  ) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers: {
            origin,
            cookie: cookieName ? `${cookieName}=opaque-token` : undefined,
          },
        }),
      }),
    }) as unknown as ExecutionContext;

  it('allows safe methods without Origin', () =>
    expect(guard.canActivate(context('GET'))).toBe(true));

  it('does not apply cookie CSRF enforcement to public mutation without a protected cookie', () =>
    expect(guard.canActivate(context('POST', undefined, null))).toBe(true));

  it('rejects staff cookie-authenticated mutation without approved Origin', () =>
    expect(() => guard.canActivate(context('POST'))).toThrow(
      'Request origin is not allowed.',
    ));

  it('rejects patient booking cookie mutation without approved Origin', () =>
    expect(() =>
      guard.canActivate(context('PATCH', undefined, 'cq_booking_access')),
    ).toThrow('Request origin is not allowed.'));

  it('rejects patient group cookie mutation from an unapproved Origin', () =>
    expect(() =>
      guard.canActivate(
        context('POST', 'https://evil.example.com', 'cq_booking_group_access'),
      ),
    ).toThrow('Request origin is not allowed.'));

  it('allows protected cookie mutation from approved Origin', () =>
    expect(guard.canActivate(context('POST', 'https://app.example.com'))).toBe(
      true,
    ));
});
