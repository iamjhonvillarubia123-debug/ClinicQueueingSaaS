import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountRegistrationService } from '../auth/account-registration.service';
import { AuthenticationService } from '../auth/authentication.service';
import { DoctorController } from './doctor.controller';
import { DoctorDataRetentionService } from './doctor-data-retention.service';
import { DoctorDefaultsApplyService } from './doctor-defaults-apply.service';
import { DoctorDefaultsService } from './doctor-defaults.service';
import { DoctorLifecycleService } from './doctor-lifecycle.service';
import { DoctorService } from './doctor.service';

describe('DoctorController', () => {
  let controller: DoctorController;

  const accountRegistrationServiceMock = {};
  const doctorServiceMock = {};
  const doctorLifecycleServiceMock = {};
  const doctorDefaultsServiceMock = {};
  const doctorDefaultsApplyServiceMock = {};
  const doctorDataRetentionServiceMock = {};
  const authenticationServiceMock = {};
  const configServiceMock = {
    get: jest.fn().mockReturnValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DoctorController],
      providers: [
        {
          provide: AccountRegistrationService,
          useValue: accountRegistrationServiceMock,
        },
        { provide: DoctorService, useValue: doctorServiceMock },
        {
          provide: DoctorLifecycleService,
          useValue: doctorLifecycleServiceMock,
        },
        { provide: DoctorDefaultsService, useValue: doctorDefaultsServiceMock },
        {
          provide: DoctorDefaultsApplyService,
          useValue: doctorDefaultsApplyServiceMock,
        },
        {
          provide: DoctorDataRetentionService,
          useValue: doctorDataRetentionServiceMock,
        },
        { provide: AuthenticationService, useValue: authenticationServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    controller = module.get<DoctorController>(DoctorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
