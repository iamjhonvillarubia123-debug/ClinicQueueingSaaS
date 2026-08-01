import { Test, TestingModule } from '@nestjs/testing';
import { PracticeLocationService } from './practice-location.service';

describe('PracticeLocationService', () => {
  let service: PracticeLocationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PracticeLocationService],
    }).compile();

    service = module.get<PracticeLocationService>(PracticeLocationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
