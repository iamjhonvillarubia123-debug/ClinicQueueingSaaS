import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { CorrelatedRequest } from './request-correlation.middleware';

@Catch()
export class RequestIdExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RequestIdExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<CorrelatedRequest>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId ?? randomUUID();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (
        typeof payload === 'object' &&
        payload !== null &&
        !Array.isArray(payload)
      ) {
        response.status(status).json({ ...payload, requestId });
        return;
      }

      response.status(status).json({
        statusCode: status,
        message: String(payload),
        requestId,
      });
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `Unhandled request exception requestId=${requestId}: ${error.message}`,
        error.stack,
      );
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      requestId,
    });
  }
}
