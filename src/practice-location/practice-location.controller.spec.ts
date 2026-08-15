import { Test, TestingModule } from '@nestjs/testing';
import { PracticeLocationController } from './practice-location.controller';
import { PracticeLocationService } from './practice-location.service';

describe('PracticeLocationController', () => {
  let controller: PracticeLocationController;

  const practiceLocationServiceMock = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PracticeLocationController],
      providers: [
        {
          provide: PracticeLocationService,
          useValue: practiceLocationServiceMock,
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
