import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationService } from '../auth/authentication.service';
import { PracticeLocationLifecycleService } from './practice-location-lifecycle.service';
import { PracticeLocationController } from './practice-location.controller';
import { PracticeLocationService } from './practice-location.service';

describe('PracticeLocationController', () => {
  let controller: PracticeLocationController;

  const practiceLocationServiceMock = {};
  const practiceLocationLifecycleServiceMock = {};
  const authenticationServiceMock = {};
  const configServiceMock = {
    get: jest.fn().mockReturnValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PracticeLocationController],
      providers: [
        {
          provide: PracticeLocationService,
          useValue: practiceLocationServiceMock,
        },
        {
          provide: PracticeLocationLifecycleService,
          useValue: practiceLocationLifecycleServiceMock,
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

    controller = module.get<PracticeLocationController>(
      PracticeLocationController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
