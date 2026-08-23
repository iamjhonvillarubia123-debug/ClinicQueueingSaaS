import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

export type CorrelatedRequest = Request & {
  requestId?: string;
};

@Injectable()
export class RequestCorrelationMiddleware implements NestMiddleware {
  use(
    request: CorrelatedRequest,
    response: Response,
    next: NextFunction,
  ): void {
    const requestId = randomUUID();
    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
