import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { performance } from 'node:perf_hooks';

type OperationalLogRequest = Pick<Request, 'method'> & {
  requestId?: string;
  route?: unknown;
};

type RouteInfo = {
  path?: unknown;
};

function resultCategory(statusCode: number): string {
  if (statusCode >= 500) return 'server_error';
  if (statusCode >= 400) return 'client_error';
  if (statusCode >= 300) return 'redirect';
  return 'success';
}

function safeRouteIdentifier(request: OperationalLogRequest): string {
  const route: unknown = request.route;
  if (typeof route !== 'object' || route === null) return 'UNMATCHED';

  const routePath = (route as RouteInfo).path;
  return typeof routePath === 'string' && routePath.length > 0
    ? routePath
    : 'UNMATCHED';
}

@Injectable()
export class OperationalLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HttpRequest');

  use(
    request: OperationalLogRequest,
    response: Response,
    next: NextFunction,
  ): void {
    const startedAt = performance.now();

    response.once('finish', () => {
      const record = {
        requestId: request.requestId ?? 'MISSING',
        operation: 'HTTP_REQUEST',
        method: request.method,
        route: safeRouteIdentifier(request),
        result: resultCategory(response.statusCode),
        statusCode: response.statusCode,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };

      this.logger.log(JSON.stringify(record));
    });

    next();
  }
}
