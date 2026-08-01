import { Test, TestingModule } from '@nestjs/testing';
import { PracticeLocationController } from './practice-location.controller';

describe('PracticeLocationController', () => {
  let controller: PracticeLocationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PracticeLocationController],
    }).compile();

    controller = module.get<PracticeLocationController>(PracticeLocationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
