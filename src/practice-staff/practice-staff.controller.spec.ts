import { Test, TestingModule } from '@nestjs/testing';
import { PracticeStaffController } from './practice-staff.controller';

describe('PracticeStaffController', () => {
  let controller: PracticeStaffController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PracticeStaffController],
    }).compile();

    controller = module.get<PracticeStaffController>(PracticeStaffController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
