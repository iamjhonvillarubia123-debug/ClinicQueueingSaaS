import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'node:http';
import { AccountSecurityController } from './account-security.controller';
import { SessionManagementService } from './session-management.service';
import { AuthenticationService } from './authentication.service';
import { SESSION_COOKIE_NAME } from './security/session-security';
import { DoctorAccountDataController } from '../doctor/doctor-account-data.controller';
import { DoctorAccountDataService } from '../doctor/doctor-account-data.service';
describe('Settings sensitive HTTP boundary', () => {
  let app: INestApplication;
  const sessions = { changePassword: jest.fn() };
  const data = { export: jest.fn(), inventory: jest.fn() };
  const actor = { userId: 'owner', role: 'DOCTOR', sessionId: 'current' };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AccountSecurityController, DoctorAccountDataController],
      providers: [
        { provide: SessionManagementService, useValue: sessions },
        { provide: DoctorAccountDataService, useValue: data },
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
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());
  it('rejects anonymous or cross-origin sensitive actions', async () => {
    for (const path of [
      '/auth/account/change-password',
      '/doctor/account/export',
    ]) {
      await request(app.getHttpServer() as Server)
        .post(path)
        .send({})
        .expect(401);
      await request(app.getHttpServer() as Server)
        .post(path)
        .set('Cookie', `${SESSION_COOKIE_NAME}=test`)
        .set('Origin', 'https://foreign.test')
        .send({})
        .expect(403);
    }
    expect(data.export).not.toHaveBeenCalled();
    expect(sessions.changePassword).not.toHaveBeenCalled();
  });
  it('rejects client-selected identities and missing password confirmations', async () => {
    await request(app.getHttpServer() as Server)
      .post('/doctor/account/export')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test`)
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'current', kind: 'ACCOUNT', userId: 'victim' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post('/auth/account/change-password')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test`)
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'current', newPassword: 'new password' })
      .expect(400);
    expect(data.export).not.toHaveBeenCalled();
    expect(sessions.changePassword).not.toHaveBeenCalled();
  });
  it('passes only the authenticated account context and disables export caching', async () => {
    data.export.mockResolvedValue({ patientDataIncluded: false });
    await request(app.getHttpServer() as Server)
      .post('/doctor/account/export')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test`)
      .set('Origin', 'http://localhost:5173')
      .send({ currentPassword: 'current', kind: 'SETTINGS' })
      .expect('Cache-Control', 'no-store')
      .expect(201);
    expect(data.export).toHaveBeenCalledWith(actor, 'current', true);
  });
});
