import { Test, TestingModule } from '@nestjs/testing';
import { PracticeStaffController } from './practice-staff.controller';
import { PracticeStaffService } from './practice-staff.service';

describe('PracticeStaffController', () => {
  let controller: PracticeStaffController;

  const practiceStaffServiceMock = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PracticeStaffController],
      providers: [
        {
          provide: PracticeStaffService,
          useValue: practiceStaffServiceMock,
        },
      ],
    }).compile();

    controller = module.get<PracticeStaffController>(
      PracticeStaffController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});