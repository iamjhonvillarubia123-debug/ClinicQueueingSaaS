import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  readCookie,
  SESSION_COOKIE_NAME,
} from '../security/session-security';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const sessionToken = readCookie(
      request.headers.cookie,
      SESSION_COOKIE_NAME,
    );
    if (!sessionToken) return true;

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
