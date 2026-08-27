import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { readCookie, SESSION_COOKIE_NAME } from '../security/session-security';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_PROTECTED_COOKIE_NAMES = [
  SESSION_COOKIE_NAME,
  'cq_booking_access',
  'cq_booking_group_access',
];

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const hasCookieCredential = CSRF_PROTECTED_COOKIE_NAMES.some((name) =>
      Boolean(readCookie(request.headers.cookie, name)),
    );
    if (!hasCookieCredential) return true;

    const configuredOrigin = this.configService.get<string>('WEB_APP_ORIGIN');
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    if (isProduction && !configuredOrigin) {
      throw new InternalServerErrorException(
        'Production web origin is not configured.',
      );
    }

    const expectedOrigin = configuredOrigin ?? 'http://localhost:3000';
    const origin = request.headers.origin;

    if (!origin || origin !== expectedOrigin) {
      throw new ForbiddenException('Request origin is not allowed.');
    }

    return true;
  }
}
