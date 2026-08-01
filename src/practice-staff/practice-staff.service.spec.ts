import { Test, TestingModule } from '@nestjs/testing';
import { PracticeStaffService } from './practice-staff.service';

describe('PracticeStaffService', () => {
  let service: PracticeStaffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PracticeStaffService],
    }).compile();

    service = module.get<PracticeStaffService>(PracticeStaffService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
