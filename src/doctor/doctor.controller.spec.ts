import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationService } from '../auth/authentication.service';
import { DoctorController } from './doctor.controller';
import { DoctorLifecycleService } from './doctor-lifecycle.service';
import { DoctorService } from './doctor.service';

describe('DoctorController', () => {
  let controller: DoctorController;

  const doctorServiceMock = {};
  const doctorLifecycleServiceMock = {};
  const authenticationServiceMock = {};
  const configServiceMock = {
    get: jest.fn().mockReturnValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DoctorController],
      providers: [
        {
          provide: DoctorService,
          useValue: doctorServiceMock,
        },
        {
          provide: DoctorLifecycleService,
          useValue: doctorLifecycleServiceMock,
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

    controller = module.get<DoctorController>(DoctorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
