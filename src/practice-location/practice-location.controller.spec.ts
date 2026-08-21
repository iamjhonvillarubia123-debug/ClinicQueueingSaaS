import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationService } from '../auth/authentication.service';
import { PracticeLocationActivationService } from './practice-location-activation.service';
import { PracticeLocationDataRetentionGateService } from './practice-location-data-retention-gate.service';
import { PracticeLocationLifecycleService } from './practice-location-lifecycle.service';
import { PracticeLocationPermanentDeleteService } from './practice-location-permanent-delete.service';
import { PracticeLocationController } from './practice-location.controller';
import { PracticeLocationService } from './practice-location.service';

describe('PracticeLocationController', () => {
  let controller: PracticeLocationController;

  const practiceLocationServiceMock = {};
  const practiceLocationActivationServiceMock = {
    activate: jest.fn(),
    reactivate: jest.fn(),
  };
  const practiceLocationDataRetentionGateServiceMock = {
    assertCurrentAcknowledgement: jest.fn(),
  };
  const practiceLocationLifecycleServiceMock = {};
  const practiceLocationPermanentDeleteServiceMock = {};
  const authenticationServiceMock = {};
  const configServiceMock = {
    get: jest.fn().mockReturnValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    practiceLocationDataRetentionGateServiceMock.assertCurrentAcknowledgement.mockResolvedValue(
      undefined,
    );
    practiceLocationActivationServiceMock.activate.mockResolvedValue({
      activated: true,
      replayed: false,
    });
    practiceLocationActivationServiceMock.reactivate.mockResolvedValue({
      reactivated: true,
      replayed: false,
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PracticeLocationController],
      providers: [
        {
          provide: PracticeLocationService,
          useValue: practiceLocationServiceMock,
        },
        {
          provide: PracticeLocationActivationService,
          useValue: practiceLocationActivationServiceMock,
        },
        {
          provide: PracticeLocationDataRetentionGateService,
          useValue: practiceLocationDataRetentionGateServiceMock,
        },
        {
          provide: PracticeLocationLifecycleService,
          useValue: practiceLocationLifecycleServiceMock,
        },
        {
          provide: PracticeLocationPermanentDeleteService,
          useValue: practiceLocationPermanentDeleteServiceMock,
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

  it('checks current Doctor acknowledgement before activation', async () => {
    const request = { user: { userId: 'doctor-1' } };
    const dto = { practiceLocationId: 'location-1' };

    await controller.activate(dto, 'activation-key', request as never);

    expect(
      practiceLocationDataRetentionGateServiceMock.assertCurrentAcknowledgement,
    ).toHaveBeenCalledWith('doctor-1');
    expect(practiceLocationActivationServiceMock.activate).toHaveBeenCalledWith(
      'doctor-1',
      dto,
      'activation-key',
    );
  });

  it('checks current Doctor acknowledgement before reactivation', async () => {
    const request = { user: { userId: 'doctor-1' } };
    const dto = { practiceLocationId: 'location-1' };

    await controller.reactivate(dto, 'reactivation-key', request as never);

    expect(
      practiceLocationDataRetentionGateServiceMock.assertCurrentAcknowledgement,
    ).toHaveBeenCalledWith('doctor-1');
    expect(
      practiceLocationActivationServiceMock.reactivate,
    ).toHaveBeenCalledWith('doctor-1', dto, 'reactivation-key');
  });
});
