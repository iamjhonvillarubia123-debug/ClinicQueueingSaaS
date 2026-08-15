import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationService } from './authentication.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';

describe('AuthController', () => {
  let controller: AuthController;

  const authServiceMock = { login: jest.fn(), logout: jest.fn() };
  const authenticationServiceMock = {};
  const emailVerificationServiceMock = {};
  const passwordResetServiceMock = {};
  const configServiceMock = {
    get: jest.fn().mockReturnValue('http://localhost:3000'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
        {
          provide: AuthenticationService,
          useValue: authenticationServiceMock,
        },
        {
          provide: EmailVerificationService,
          useValue: emailVerificationServiceMock,
        },
        {
          provide: PasswordResetService,
          useValue: passwordResetServiceMock,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('sets the opaque login token only in an HttpOnly cookie and not in JSON', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    authServiceMock.login.mockResolvedValue({
      sessionToken: 'raw-session-token',
      response: {
        user: { id: 'user-1', role: 'DOCTOR' },
        lastLoginAt: new Date('2026-08-15T00:00:00.000Z'),
      },
    });
    const cookieMock = jest.fn();
    const response = { cookie: cookieMock } as unknown as Response;

    try {
      const body = await controller.login(
        { email: 'doctor@example.com', password: 'password' },
        response,
      );
      expect(cookieMock).toHaveBeenCalledWith(
        'clinic_session',
        'raw-session-token',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 12 * 60 * 60 * 1000,
        }),
      );
      expect(body).not.toHaveProperty('sessionToken');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
