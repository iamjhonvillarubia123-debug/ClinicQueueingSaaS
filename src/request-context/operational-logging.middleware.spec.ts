import { Logger } from '@nestjs/common';
import type { NextFunction } from 'express';
import { EventEmitter } from 'node:events';
import { OperationalLoggingMiddleware } from './operational-logging.middleware';

type TestRequestShape = {
  requestId?: string;
  method: string;
  route?: { path?: unknown };
  body?: unknown;
  originalUrl?: string;
};

type TestResponse = EventEmitter & {
  statusCode: number;
};

function createTestResponse(statusCode: number): TestResponse {
  return Object.assign(new EventEmitter(), { statusCode });
}

describe('OperationalLoggingMiddleware', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs request correlation and route template without raw URL or body data', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const middleware = new OperationalLoggingMiddleware();
    const request: TestRequestShape = {
      requestId: '5f8ef3b4-fbb8-4f23-a39d-5b8e75e4f6f2',
      method: 'POST',
      route: { path: '/patient/bookings/:accessToken' },
      originalUrl:
        '/patient/bookings/raw-secret-token?mobileNumber=09171234567',
      body: {
        otp: '123456',
        password: 'raw-password',
        bookingAnswer: 'sensitive patient free text',
      },
    };
    const response = createTestResponse(401);
    const next: NextFunction = jest.fn();

    middleware.use(request, response, next);
    response.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);

    const message = String(log.mock.calls[0]?.[0]);
    expect(message).toContain(request.requestId ?? '');
    expect(message).toContain('/patient/bookings/:accessToken');
    expect(message).toContain('client_error');
    expect(message).not.toContain('raw-secret-token');
    expect(message).not.toContain('09171234567');
    expect(message).not.toContain('123456');
    expect(message).not.toContain('raw-password');
    expect(message).not.toContain('sensitive patient free text');
  });

  it('uses a non-identifying route marker for unmatched requests', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const middleware = new OperationalLoggingMiddleware();
    const request: TestRequestShape = {
      requestId: '1e36f17e-66fe-43b5-8108-440483941be5',
      method: 'GET',
      originalUrl: '/unknown/private-value',
    };
    const response = createTestResponse(404);

    middleware.use(request, response, jest.fn());
    response.emit('finish');

    const message = String(log.mock.calls[0]?.[0]);
    expect(message).toContain('UNMATCHED');
    expect(message).not.toContain('/unknown/private-value');
  });
});
