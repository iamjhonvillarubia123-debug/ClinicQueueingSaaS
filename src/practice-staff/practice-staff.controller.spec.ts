import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationService } from '../auth/authentication.service';
import { ClinicSecretaryAuthorityService } from './clinic-secretary-authority.service';
import { PracticeStaffController } from './practice-staff.controller';

describe('PracticeStaffController', () => {
  let controller: PracticeStaffController;

  const clinicSecretaryAuthorityServiceMock = {};
  const authenticationServiceMock = {};
  const configServiceMock = {
    get: jest.fn().mockReturnValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PracticeStaffController],
      providers: [
        {
          provide: ClinicSecretaryAuthorityService,
          useValue: clinicSecretaryAuthorityServiceMock,
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
