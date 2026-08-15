import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationService } from '../auth/authentication.service';
import { PracticeStaffController } from './practice-staff.controller';
import { PracticeStaffService } from './practice-staff.service';

describe('PracticeStaffController', () => {
  let controller: PracticeStaffController;

  const practiceStaffServiceMock = {};
  const authenticationServiceMock = {};
  const configServiceMock = {
    get: jest.fn().mockReturnValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PracticeStaffController],
      providers: [
        {
          provide: PracticeStaffService,
          useValue: practiceStaffServiceMock,
        },
        {
          provide: AuthenticationService,
          useValue: authenticationServiceMock,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    }).compile();

    controller = module.get<PracticeStaffController>(PracticeStaffController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
