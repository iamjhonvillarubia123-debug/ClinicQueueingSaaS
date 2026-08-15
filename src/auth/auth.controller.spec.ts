import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationService } from './authentication.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';

describe('AuthController', () => {
  let controller: AuthController;

  const authServiceMock = {};
  const authenticationServiceMock = {};
  const emailVerificationServiceMock = {};

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
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
