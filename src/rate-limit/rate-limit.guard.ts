import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  RATE_LIMIT_POLICY,
  type RateLimitPolicy,
  type RateLimitSubject,
} from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.configService.get<string>('RATE_LIMIT_ENABLED', 'true') === 'false') {
      return true;
    }

    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(
      RATE_LIMIT_POLICY,
      [context.getHandler(), context.getClass()],
    );
    if (!policy) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const clientIp = request.ip || request.socket.remoteAddress || 'unknown';
    const subject = this.resolveSubject(request, policy.subject);
    const result = await this.rateLimitService.consume(
      policy,
      clientIp,
      subject,
    );

    if (result.allowed) return true;

    response.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new HttpException(
      {
        statusCode: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
      429,
    );
  }

  private resolveSubject(request: Request, subject: RateLimitSubject): string {
    if (subject.kind === 'NONE') return 'none';

    if (subject.kind === 'PARAM') {
      const value = request.params?.[subject.field];
      return typeof value === 'string' && value.trim()
        ? value.trim().toLowerCase()
        : 'missing';
    }

    const body = request.body as Record<string, unknown> | undefined;
    const value = body?.[subject.field];
    return typeof value === 'string' && value.trim()
      ? value.trim().toLowerCase()
      : 'missing';
  }
}
