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
    withSessionCookie = true,
  ) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers: {
            origin,
            cookie: withSessionCookie
              ? `${SESSION_COOKIE_NAME}=opaque-session-token`
              : undefined,
          },
        }),
      }),
    }) as unknown as ExecutionContext;

  it('allows safe methods without Origin', () =>
    expect(guard.canActivate(context('GET'))).toBe(true));

  it('does not apply cookie CSRF enforcement to public mutation without a session cookie', () =>
    expect(guard.canActivate(context('POST', undefined, false))).toBe(true));

  it('rejects cookie-authenticated state-changing request without approved Origin', () =>
    expect(() => guard.canActivate(context('POST'))).toThrow(
      'Request origin is not allowed.',
    ));

  it('rejects cookie-authenticated state-changing request from an unapproved Origin', () =>
    expect(() =>
      guard.canActivate(context('PATCH', 'https://evil.example.com')),
    ).toThrow('Request origin is not allowed.'));

  it('allows cookie-authenticated state-changing request from approved Origin', () =>
    expect(guard.canActivate(context('POST', 'https://app.example.com'))).toBe(
      true,
    ));
});
