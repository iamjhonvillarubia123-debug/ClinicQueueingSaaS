import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const expectedOrigin =
      this.configService.get<string>('WEB_APP_ORIGIN') ??
      'http://localhost:3000';
    const origin = request.headers.origin;

    if (!origin || origin !== expectedOrigin) {
      throw new ForbiddenException('Request origin is not allowed.');
    }

    return true;
  }
}
