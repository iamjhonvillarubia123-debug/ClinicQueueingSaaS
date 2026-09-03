import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'node:http';
import { AuthenticationService } from './authentication.service';
import { SessionManagementController } from './session-management.controller';
import { SessionManagementService } from './session-management.service';
import { SESSION_COOKIE_NAME } from './security/session-security';
import { RATE_LIMIT_POLICY } from '../rate-limit/rate-limit.decorator';

describe('SessionManagementController security boundary', () => {
  let app: INestApplication;
  const sessions = {
    list: jest.fn(),
    revokeOne: jest.fn(),
    revokeOthers: jest.fn(),
  };
  const actor = { userId: 'owner', role: 'DOCTOR', sessionId: 'current' };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SessionManagementController],
      providers: [
        { provide: SessionManagementService, useValue: sessions },
        {
          provide: AuthenticationService,
          useValue: {
            authenticateOrdinarySession: jest.fn().mockResolvedValue(actor),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'WEB_APP_ORIGIN' ? 'http://localhost:5173' : undefined,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    sessions.list.mockResolvedValue({ sessions: [] });
    sessions.revokeOthers.mockResolvedValue({ revokedCount: 1 });
  });
  afterAll(async () => {
    await app.close();
  });
  it('rejects unauthenticated reads and mutations', async () => {
    await request(app.getHttpServer() as Server)
      .get('/auth/sessions')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/auth/sessions/revoke-others')
      .send({ currentPassword: 'test' })
      .expect(401);
    expect(sessions.list).not.toHaveBeenCalled();
    expect(sessions.revokeOthers).not.toHaveBeenCalled();
  });
  it('rejects cross-origin mutations', async () => {
    await request(app.getHttpServer() as Server)
      .post('/auth/sessions/revoke-others')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test`)
      .set('Origin', 'https://unrelated.example')
      .send({ currentPassword: 'test' })
      .expect(403);
    expect(sessions.revokeOthers).not.toHaveBeenCalled();
  });
  it('does not accept client-selected account or current session IDs', async () => {
    await request(app.getHttpServer() as Server)
      .post('/auth/sessions/revoke-others')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test`)
      .set('Origin', 'http://localhost:5173')
      .send({
        currentPassword: 'test',
        userId: 'victim',
        sessionId: 'victim-session',
      })
      .expect(400);
    expect(sessions.revokeOthers).not.toHaveBeenCalled();
  });
  it('requires a nonempty password and validates target IDs', async () => {
    await request(app.getHttpServer() as Server)
      .post('/auth/sessions/revoke-others')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test`)
      .set('Origin', 'http://localhost:5173')
      .send({})
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/auth/sessions/not-a-uuid/revoke')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test`)
      .set('Origin', 'http://localhost:5173')
      .expect(400);
  });
  it('uses authenticated identity and has a password-attempt rate policy', async () => {
    await request(app.getHttpServer() as Server)
      .post('/auth/sessions/revoke-others')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test`)
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'test' })
      .expect(201);
    expect(sessions.revokeOthers).toHaveBeenCalledWith(actor, 'test');
    const policy: { limit: number } = Reflect.getMetadata(
      RATE_LIMIT_POLICY,
      // Metadata inspection intentionally reads the method without calling it.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      SessionManagementController.prototype.revokeOthers,
    ) as { limit: number };
    expect(policy.limit).toBe(10);
  });
});
